import { describe, it, expect } from 'vitest';
import type { ValuesTree } from '../types/helm';
import {
  computeValuesDiff,
  exportDiffAsMarkdown,
  exportDiffAsJson
} from './valueDiff';

describe('valueDiff', () => {
  const baseTree: ValuesTree = {
    env: 'dev',
    raw: {},
    entries: [
      { key: 'global.registry', value: 'docker.io', type: 'string', usedInTemplates: [] },
      { key: 'replicaCount', value: 3, type: 'number', usedInTemplates: [] },
      { key: 'enableIngress', value: true, type: 'boolean', usedInTemplates: [] },
      { key: 'typeChangedKey', value: '123', type: 'string', usedInTemplates: [] },
    ],
  };

  const compareTree: ValuesTree = {
    env: 'prd',
    raw: {},
    entries: [
      { key: 'global.registry', value: 'docker.io', type: 'string', usedInTemplates: [] }, // unchanged
      { key: 'replicaCount', value: 5, type: 'number', usedInTemplates: [] }, // changed value
      { key: 'newKey', value: 'hello', type: 'string', usedInTemplates: [] }, // added key
      { key: 'typeChangedKey', value: 123, type: 'number', usedInTemplates: [] }, // type changed
      // 'enableIngress' is removed
    ],
  };

  describe('computeValuesDiff', () => {
    it('correctly identifies added, removed, changed, and unchanged keys', () => {
      const diff = computeValuesDiff(baseTree, compareTree);

      expect(diff.changedKeys).toContain('replicaCount');
      expect(diff.changedKeys).toContain('newKey');
      expect(diff.changedKeys).toContain('typeChangedKey');
      expect(diff.changedKeys).toContain('enableIngress');
      expect(diff.changedKeys).not.toContain('global.registry');

      const entryMap = new Map(diff.entries.map(e => [e.key, e]));

      expect(entryMap.get('global.registry')?.status).toBe('unchanged');
      expect(entryMap.get('replicaCount')?.status).toBe('changed');
      expect(entryMap.get('newKey')?.status).toBe('added');
      expect(entryMap.get('typeChangedKey')?.status).toBe('changed');
      expect(entryMap.get('enableIngress')?.status).toBe('removed');
    });

    it('calculates diff summary correctly', () => {
      const diff = computeValuesDiff(baseTree, compareTree);

      expect(diff.summary.total).toBe(4); // replicaCount, newKey, typeChangedKey, enableIngress (all changes)
      expect(diff.summary.added).toBe(1); // newKey
      expect(diff.summary.removed).toBe(1); // enableIngress
      expect(diff.summary.changed).toBe(2); // replicaCount, typeChangedKey
      expect(diff.summary.breaking).toBe(2); // removed (enableIngress) + type changed (typeChangedKey)
    });

    it('sorts entries by removed -> changed -> added -> unchanged, then alphabetically', () => {
      const diff = computeValuesDiff(baseTree, compareTree);
      const statuses = diff.entries.map(e => e.status);

      // Check sorting of statuses
      const expectedStatusOrder = ['removed', 'changed', 'changed', 'added', 'unchanged'];
      expect(statuses).toEqual(expectedStatusOrder);

      // Check alphabetical sorting inside status groups
      const keys = diff.entries.map(e => e.key);
      expect(keys[1]).toBe('replicaCount'); // "replicaCount" < "typeChangedKey" (changed)
      expect(keys[2]).toBe('typeChangedKey');
    });
  });

  describe('exportDiffAsMarkdown', () => {
    it('produces a formatted markdown string', () => {
      const diff = computeValuesDiff(baseTree, compareTree);
      const md = exportDiffAsMarkdown(diff, 'dev', 'prd');

      expect(md).toContain('# Helm Values Diff: `dev` → `prd`');
      expect(md).toContain('## Summary');
      expect(md).toContain('| Metric | Count |');
      expect(md).toContain('## Changed Keys');
      expect(md).toContain('✅ added');
      expect(md).toContain('❌ removed');
      expect(md).toContain('⚠️ changed');
    });
  });

  describe('exportDiffAsJson', () => {
    it('produces a valid JSON string with detailed changes', () => {
      const diff = computeValuesDiff(baseTree, compareTree);
      const jsonStr = exportDiffAsJson(diff, 'dev', 'prd');
      const data = JSON.parse(jsonStr);

      expect(data.base).toBe('dev');
      expect(data.compare).toBe('prd');
      expect(data.summary.breaking).toBe(2);
      expect(data.changes).toHaveLength(4);

      const changeMap = new Map<string, any>(data.changes.map((c: any) => [c.key, c]));
      expect(changeMap.get('newKey')?.status).toBe('added');
      expect(changeMap.get('newKey')?.to).toBe('hello');

      expect(changeMap.get('enableIngress')?.status).toBe('removed');
      expect(changeMap.get('enableIngress')?.from).toBe(true);

      expect(changeMap.get('typeChangedKey')?.status).toBe('changed');
      expect(changeMap.get('typeChangedKey')?.typeChange).toBe('string → number');
    });
  });
});
