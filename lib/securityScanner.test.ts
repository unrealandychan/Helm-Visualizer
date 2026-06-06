import { describe, it, expect } from "vitest";
import { scanResource, scanEnvironment } from "./securityScanner";
import type { K8sResource } from "@/types/helm";

describe("securityScanner", () => {
  describe("scanResource", () => {
    it("flags an insecure Deployment", () => {
      const insecureDep: K8sResource = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "insecure-app",
        },
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: "web",
                  image: "nginx:latest", // Violation: latest tag
                  securityContext: {
                    privileged: true, // Violation: privileged
                    runAsNonRoot: false, // Violation: root
                  },
                  // Violation: missing resource requests/limits
                  // Violation: missing liveness/readiness probes
                },
              ],
            },
          },
        },
      };

      const violations = scanResource(insecureDep);
      const ids = violations.map((v) => v.id);

      expect(ids).toContain("run-as-non-root");
      expect(ids).toContain("privileged-container");
      expect(ids).toContain("resource-limits");
      expect(ids).toContain("resource-requests");
      expect(ids).toContain("image-tag-latest");
      expect(ids).toContain("missing-probes");
    });

    it("passes a fully secure Deployment", () => {
      const secureDep: K8sResource = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "secure-app",
        },
        spec: {
          template: {
            spec: {
              securityContext: {
                runAsNonRoot: true,
              },
              containers: [
                {
                  name: "web",
                  image: "nginx:1.25.1",
                  securityContext: {
                    readOnlyRootFilesystem: true,
                  },
                  resources: {
                    limits: {
                      cpu: "500m",
                      memory: "256Mi",
                    },
                    requests: {
                      cpu: "100m",
                      memory: "128Mi",
                    },
                  },
                  livenessProbe: {
                    httpGet: { path: "/health", port: 80 },
                  },
                  readinessProbe: {
                    httpGet: { path: "/ready", port: 80 },
                  },
                },
              ],
            },
          },
        },
      };

      const violations = scanResource(secureDep);
      expect(violations).toHaveLength(0);
    });

    it("flags a Service with missing selector", () => {
      const badService: K8sResource = {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "bad-service",
        },
        spec: {
          type: "ClusterIP",
          ports: [{ port: 80 }],
          // Missing selector
        },
      };

      const violations = scanResource(badService);
      expect(violations.map((v) => v.id)).toContain("service-selector");
    });

    it("ignores ExternalName Services for selector rules", () => {
      const extService: K8sResource = {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "ext-service",
        },
        spec: {
          type: "ExternalName",
          externalName: "my.database.com",
        },
      };

      const violations = scanResource(extService);
      expect(violations).toHaveLength(0);
    });
  });

  describe("scanEnvironment", () => {
    it("scans and maps environmental violations", () => {
      const resources: K8sResource[] = [
        {
          apiVersion: "v1",
          kind: "Service",
          metadata: { name: "svc" },
          spec: { type: "ClusterIP" }, // Bad: missing selector
        },
        {
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: "cm" },
          data: { foo: "bar" }, // Safe
        },
      ];

      const envMap = scanEnvironment(resources);
      expect(envMap.size).toBe(1);
      expect(envMap.get("Service/svc")).toBeDefined();
      expect(envMap.get("Service/svc")?.[0].id).toBe("service-selector");
    });
  });
});
