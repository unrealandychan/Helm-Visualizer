import { describe, it, expect } from "vitest";
import { sanitizeLiveResource, diffResources } from "./clusterDiffer";
import type { K8sResource } from "@/types/helm";

describe("clusterDiffer", () => {
  describe("sanitizeLiveResource", () => {
    it("strips read-only metadata and status fields", () => {
      const liveRaw = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "my-pod",
          uid: "some-long-uuid",
          resourceVersion: "12345",
          generation: 2,
          creationTimestamp: "2026-06-06T12:00:00Z",
          managedFields: [{ manager: "kube-controller" }],
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": "{}",
            "other-annotation": "value",
          },
        },
        status: {
          phase: "Running",
        },
        spec: {
          containers: [{ name: "web" }],
        },
      };

      const clean = sanitizeLiveResource(liveRaw);

      expect(clean.status).toBeUndefined();
      expect(clean.metadata).toBeDefined();

      const metadata = clean.metadata as Record<string, unknown>;
      const annotations = metadata.annotations as Record<string, unknown>;

      expect(metadata.uid).toBeUndefined();
      expect(metadata.resourceVersion).toBeUndefined();
      expect(metadata.generation).toBeUndefined();
      expect(metadata.creationTimestamp).toBeUndefined();
      expect(metadata.managedFields).toBeUndefined();
      expect(annotations?.["kubectl.kubernetes.io/last-applied-configuration"]).toBeUndefined();
      expect(annotations?.["other-annotation"]).toBe("value");
    });
  });

  describe("diffResources", () => {
    const localResource: K8sResource = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "my-deploy" },
      spec: { replicas: 3 },
    };

    it("returns local-only if live is null", () => {
      const result = diffResources(localResource, null);
      expect(result.syncStatus).toBe("local-only");
      expect(result.liveYaml).toBeNull();
    });

    it("returns in-sync if local matches cleaned live", () => {
      const liveRaw = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "my-deploy",
          uid: "abc",
          creationTimestamp: "2026-06-06",
        },
        spec: { replicas: 3 },
        status: { readyReplicas: 3 },
      };

      const result = diffResources(localResource, liveRaw);
      expect(result.syncStatus).toBe("in-sync");
      expect(result.liveYaml).toContain("replicas: 3");
    });

    it("returns out-of-sync if there is a config difference", () => {
      const liveRaw = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "my-deploy" },
        spec: { replicas: 1 }, // Diff
      };

      const result = diffResources(localResource, liveRaw);
      expect(result.syncStatus).toBe("out-of-sync");
    });
  });
});
