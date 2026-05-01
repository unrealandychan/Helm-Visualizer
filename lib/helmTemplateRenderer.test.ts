import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { renderHelmChartJS } from './helmTemplateRenderer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CHART_YAML = 'apiVersion: v2\nname: test-chart\nversion: 0.1.0\n';

/** Wraps YAML content as a minimal K8s ConfigMap so splitRenderedDocs keeps it. */
function configMap(name: string, data: Record<string, string>): string {
  const dataLines = Object.entries(data)
    .map(([k, v]) => `  ${k}: "${v}"`)
    .join('\n');
  return [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    'data:',
    dataLines,
    '',
  ].join('\n');
}

/** Creates a minimal Helm chart directory under a fresh temp folder. */
function createChart(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-test-'));
  fs.writeFileSync(path.join(dir, 'Chart.yaml'), BASE_CHART_YAML);
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderHelmChartJS', () => {
  let chartDir: string;

  afterEach(() => {
    if (chartDir) cleanup(chartDir);
  });

  // -------------------------------------------------------------------------
  it('resolves basic variable interpolation ({{ .Values.appName }})', async () => {
    chartDir = createChart({
      'values.yaml': 'appName: my-app\n',
      'templates/cm.yaml': configMap('{{ .Values.appName }}', { key: 'value' }),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('name: my-app');
  });

  // -------------------------------------------------------------------------
  it('uses the default filter when the value is missing', async () => {
    chartDir = createChart({
      'values.yaml': '{}\n',
      'templates/cm.yaml': configMap('test', { key: '{{ .Values.missing | default "fallback" }}' }),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('fallback');
  });

  // -------------------------------------------------------------------------
  it('renders the correct branch of an if/else block', async () => {
    chartDir = createChart({
      'values.yaml': 'enabled: true\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: flag',
        'data:',
        '{{- if .Values.enabled }}',
        '  status: active',
        '{{- else }}',
        '  status: inactive',
        '{{- end }}',
        '',
      ].join('\n'),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('status: active');
    expect(yaml).not.toContain('status: inactive');
  });

  // -------------------------------------------------------------------------
  it('renders each item when ranging over a list', async () => {
    chartDir = createChart({
      'values.yaml': 'items:\n  - alpha\n  - beta\n  - gamma\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: list',
        'data:',
        '{{- range .Values.items }}',
        '  - {{ . }}',
        '{{- end }}',
        '',
      ].join('\n'),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('alpha');
    expect(yaml).toContain('beta');
    expect(yaml).toContain('gamma');
  });

  // -------------------------------------------------------------------------
  it('exposes .Release.Name and .Chart.Name built-in values', async () => {
    chartDir = createChart({
      'values.yaml': '{}\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: meta',
        'data:',
        '  release: {{ .Release.Name }}',
        '  chart: {{ .Chart.Name }}',
        '',
      ].join('\n'),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'my-release', []);
    expect(yaml).toContain('release: my-release');
    expect(yaml).toContain('chart: test-chart');
  });

  // -------------------------------------------------------------------------
  it('renders a named template defined with define/include', async () => {
    chartDir = createChart({
      'values.yaml': 'greeting: hello\n',
      'templates/_helpers.tpl': [
        '{{- define "test-chart.greeting" -}}',
        '{{ .Values.greeting }}',
        '{{- end }}',
      ].join('\n') + '\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: greet',
        'data:',
        '  value: {{ include "test-chart.greeting" . }}',
        '',
      ].join('\n'),
    });

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('value: hello');
  });

  // -------------------------------------------------------------------------
  it('returns empty yaml when the templates/ directory is missing', async () => {
    chartDir = createChart({ 'values.yaml': '{}\n' });
    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml.trim()).toBe('');
  });

  // -------------------------------------------------------------------------
  it('records sha256sum usage in stubsUsed', async () => {
    chartDir = createChart({
      'values.yaml': 'data: hello\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: checksum',
        'data:',
        '  hash: {{ .Values.data | sha256sum }}',
        '',
      ].join('\n'),
    });

    const { stubsUsed } = await renderHelmChartJS(chartDir, 'release', []);
    expect(stubsUsed).toContain('sha256sum');
  });

  // -------------------------------------------------------------------------
  it('renders subchart templates when a charts/ subdirectory is present', async () => {
    chartDir = createChart({
      'values.yaml': '{}\n',
      'templates/parent.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: parent',
        'data:',
        '  role: parent',
        '',
      ].join('\n'),
    });

    const subchartDir = path.join(chartDir, 'charts', 'my-subchart');
    fs.mkdirSync(path.join(subchartDir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(subchartDir, 'Chart.yaml'), 'apiVersion: v2\nname: my-subchart\nversion: 0.1.0\n');
    fs.writeFileSync(path.join(subchartDir, 'templates', 'child.yaml'), [
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata:',
      '  name: child',
      'data:',
      '  role: child',
      '',
    ].join('\n'));

    const { yaml } = await renderHelmChartJS(chartDir, 'release', []);
    expect(yaml).toContain('name: parent');
    expect(yaml).toContain('name: child');
  });

  // -------------------------------------------------------------------------
  it('overrides values when a custom values file is provided', async () => {
    chartDir = createChart({
      'values.yaml': 'env: dev\n',
      'templates/cm.yaml': [
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: env',
        'data:',
        '  environment: {{ .Values.env }}',
        '',
      ].join('\n'),
    });

    const customValues = path.join(chartDir, 'values-prod.yaml');
    fs.writeFileSync(customValues, 'env: prod\n');

    const { yaml } = await renderHelmChartJS(chartDir, 'release', [customValues]);
    expect(yaml).toContain('environment: prod');
  });
});
