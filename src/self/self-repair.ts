import fs from "node:fs/promises";
import path from "node:path";
import type { SelfDiagnosticReport } from "./self-diagnostics.js";

export type PreflightCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type SelfPreflightReport = {
  ok: boolean;
  generatedAt: number;
  checks: PreflightCheck[];
};

export type RepairPlanItem = {
  title: string;
  riskLevel: "L0" | "L1" | "L2" | "L3";
  reason: string;
  suggestedTool?: string;
};

export type SelfRepairPlan = {
  ok: boolean;
  generatedAt: number;
  summary: string;
  items: RepairPlanItem[];
};

export async function runSelfPreflight(params: {
  rootDir: string;
  diagnose: () => Promise<SelfDiagnosticReport>;
}): Promise<SelfPreflightReport> {
  const checks: PreflightCheck[] = [];
  const report = await params.diagnose();
  checks.push({
    name: "self.diagnose",
    ok: report.ok,
    detail: report.summary,
  });

  for (const relativePath of ["configs/config.yaml", "package.json", "data"]) {
    const target = path.resolve(params.rootDir, relativePath);
    try {
      await fs.access(target);
      checks.push({
        name: `path.${relativePath}`,
        ok: true,
        detail: "accessible",
      });
    } catch (err) {
      checks.push({
        name: `path.${relativePath}`,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const probeFile = path.resolve(params.rootDir, "data", "run", ".write-probe");
    await fs.mkdir(path.dirname(probeFile), { recursive: true });
    await fs.writeFile(probeFile, String(Date.now()), "utf8");
    await fs.rm(probeFile, { force: true });
    checks.push({
      name: "data.write",
      ok: true,
      detail: "writable",
    });
  } catch (err) {
    checks.push({
      name: "data.write",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    generatedAt: Date.now(),
    checks,
  };
}

export function buildSelfRepairPlan(preflight: SelfPreflightReport): SelfRepairPlan {
  const items: RepairPlanItem[] = [];
  for (const check of preflight.checks) {
    if (check.ok) {
      continue;
    }
    if (check.name === "self.diagnose") {
      items.push({
        title: "Inspect failed self-diagnostic checks",
        riskLevel: "L0",
        reason: check.detail,
        suggestedTool: "self.diagnose",
      });
      continue;
    }
    if (check.name.startsWith("path.") || check.name === "data.write") {
      items.push({
        title: `Repair local path: ${check.name}`,
        riskLevel: "L2",
        reason: check.detail,
        suggestedTool: "files.backup",
      });
    }
  }
  if (items.length === 0) {
    items.push({
      title: "No repair needed",
      riskLevel: "L0",
      reason: "All preflight checks passed.",
    });
  }
  return {
    ok: preflight.ok,
    generatedAt: Date.now(),
    summary: preflight.ok ? "ready" : "repair actions suggested",
    items,
  };
}
