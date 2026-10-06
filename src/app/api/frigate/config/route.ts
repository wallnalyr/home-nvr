import { NextResponse } from "next/server";
import { getFrigateConfig } from "@/lib/frigate-client";
import {
  generateFrigateConfig,
  regenerateFrigateConfig,
} from "@/lib/frigate-config-gen";

export async function GET() {
  try {
    const config = await getFrigateConfig();
    return NextResponse.json(config);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch config";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST() {
  // This endpoint previously only generated and RETURNED the YAML without
  // pushing it — the settings "Regenerate Config" button was a placebo
  // that left Frigate running its old config while showing the user a
  // preview containing their changes.
  try {
    await regenerateFrigateConfig();
    // Preview only — its failure must not misreport the successful push
    const configYaml = await generateFrigateConfig().catch(() => null);
    return NextResponse.json({ pushed: true, configYaml });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to push config";
    return NextResponse.json(
      { pushed: false, error: message },
      { status: 502 },
    );
  }
}
