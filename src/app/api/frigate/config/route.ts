import { NextResponse } from "next/server";
import { getFrigateConfig } from "@/lib/frigate-client";
import { generateFrigateConfig } from "@/lib/frigate-config-gen";

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
  try {
    const configYaml = await generateFrigateConfig();
    return new NextResponse(configYaml, {
      headers: { "Content-Type": "text/yaml" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
