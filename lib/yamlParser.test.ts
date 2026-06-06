import { describe, it, expect } from 'vitest';
import {
  parseMultiDocYaml,
  extractValuesEntries,
  extractTemplateValueRefs,
  safeParseYaml
} from './yamlParser';

describe('yamlParser', () => {
  describe('parseMultiDocYaml', () => {
    it('parses a single valid document', () => {
      const doc = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n';
      const result = parseMultiDocYaml(doc);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'test' },
      });
    });

    it('parses multiple documents separated by ---', () => {
      const docs = [
        'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: doc1',
        '---',
        'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: doc2'
      ].join('\n');
      const result = parseMultiDocYaml(docs);
      expect(result).toHaveLength(2);
      expect(result[0].metadata.name).toBe('doc1');
      expect(result[1].metadata.name).toBe('doc2');
    });

    it('handles trailing colons in unquoted values via fallback', () => {
      // e.g. "image: registry.com/name:" which causes standard yaml parser to fail
      const doc = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\ndata:\n  image: registry.com/name:\n';
      const result = parseMultiDocYaml(doc);
      expect(result).toHaveLength(1);
      expect((result[0] as any).data.image).toBe('registry.com/name:');
    });

    it('silently skips invalid documents in multi-document parsing', () => {
      const docs = [
        'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: doc1',
        '---',
        'invalid: [unclosed bracket', // Bad yaml
        '---',
        'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: doc2'
      ].join('\n');
      const result = parseMultiDocYaml(docs);
      expect(result).toHaveLength(2);
      expect(result[0].metadata.name).toBe('doc1');
      expect(result[1].metadata.name).toBe('doc2');
    });
  });

  describe('extractValuesEntries', () => {
    it('flattens values into dot-notation entries', () => {
      const valuesYaml = [
        'global:',
        '  registry: docker.io',
        'replicaCount: 3',
        'resources:',
        '  limits:',
        '    cpu: 100m',
        'tags:',
        '  - latest',
        '  - alpine'
      ].join('\n');

      const tree = extractValuesEntries(valuesYaml, 'dev');
      expect(tree.env).toBe('dev');
      expect((tree.raw as any).global.registry).toBe('docker.io');

      const entryMap = new Map(tree.entries.map(e => [e.key, e]));
      expect(entryMap.get('global.registry')).toEqual({
        key: 'global.registry',
        value: 'docker.io',
        type: 'string',
        usedInTemplates: []
      });
      expect(entryMap.get('replicaCount')).toEqual({
        key: 'replicaCount',
        value: 3,
        type: 'number',
        usedInTemplates: []
      });
      expect(entryMap.get('resources.limits.cpu')).toEqual({
        key: 'resources.limits.cpu',
        value: '100m',
        type: 'string',
        usedInTemplates: []
      });
      expect(entryMap.get('tags')).toEqual({
        key: 'tags',
        value: ['latest', 'alpine'],
        type: 'array',
        usedInTemplates: []
      });
    });

    it('maps value-paths to template files that reference them', () => {
      const valuesYaml = [
        'db:',
        '  host: localhost',
        '  port: 5432'
      ].join('\n');

      const templateFiles = {
        'templates/deployment.yaml': 'host: {{ .Values.db.host }}',
        'templates/service.yaml': 'port: {{ .Values.db.port }}',
        'templates/unused.yaml': 'hello: world'
      };

      const tree = extractValuesEntries(valuesYaml, 'prd', templateFiles);
      const entryMap = new Map(tree.entries.map(e => [e.key, e]));

      expect(entryMap.get('db.host')?.usedInTemplates).toContain('templates/deployment.yaml');
      expect(entryMap.get('db.port')?.usedInTemplates).toContain('templates/service.yaml');
    });
  });

  describe('extractTemplateValueRefs', () => {
    it('extracts unique .Values references from a template', () => {
      const template = [
        'name: {{ .Values.appName }}',
        'image: {{ .Values.image.repository }}:{{ .Values.image.tag }}',
        'replicas: {{ .Values.replicas }}',
        'duplicate: {{ .Values.appName }}'
      ].join('\n');

      const refs = extractTemplateValueRefs(template);
      expect(refs).toHaveLength(4);
      expect(refs).toContain('appName');
      expect(refs).toContain('image.repository');
      expect(refs).toContain('image.tag');
      expect(refs).toContain('replicas');
    });
  });

  describe('safeParseYaml', () => {
    it('returns parsed object for valid YAML', () => {
      const parsed = safeParseYaml('key: value\nlist:\n  - 1\n  - 2');
      expect(parsed).toEqual({ key: 'value', list: [1, 2] });
    });

    it('returns null for invalid YAML', () => {
      expect(safeParseYaml('invalid: yaml: parsing: error:')).toBeNull();
    });

    it('returns null for non-object YAML (like string or number)', () => {
      expect(safeParseYaml('"just a string"')).toBeNull();
      expect(safeParseYaml('12345')).toBeNull();
    });
  });
});
