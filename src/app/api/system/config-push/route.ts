import { NextResponse } from "next/server";

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

export async function POST() {
  const results: Record<string, unknown> = {};

  // Step 1: Generate config from DB
  let configYaml: string;
  try {
    const { generateFrigateConfig } = await import("@/lib/frigate-config-gen");
    configYaml = await generateFrigateConfig();
    results.configGenerated = true;
    results.configPreview = configYaml.substring(0, 2000);
    results.configLength = configYaml.length;
  } catch (err) {
    results.configGenerated = false;
    results.configError = err instanceof Error ? err.message : String(err);
    return NextResponse.json(results, { status: 500 });
  }

  // Step 2: Try file write
  try {
    const { writeFile } = await import("fs/promises");
    const configPath = process.env.FRIGATE_CONFIG_PATH || "/config/frigate/config.yml";
    await writeFile(configPath, configYaml, "utf-8");
    results.fileWrite = { ok: true, path: configPath };
  } catch (err) {
    results.fileWrite = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 3: Push to Frigate API
  try {
    const saveUrl = `${FRIGATE_URL}/api/config/save?save_option=restart`;
    results.frigateUrl = saveUrl;

    const res = await fetch(saveUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: configYaml,
      signal: AbortSignal.timeout(15000),
    });

    const responseText = await res.text().catch(() => "");
    results.frigateSave = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      responseBody: responseText.substring(0, 1000),
    };
  } catch (err) {
    results.frigateSave = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Step 4: Verify — re-read Frigate config after push
  try {
    await new Promise((r) => setTimeout(r, 3000));
    const verifyRes = await fetch(`${FRIGATE_URL}/api/config`, {
      signal: AbortSignal.timeout(10000),
    });
    if (verifyRes.ok) {
      const config = await verifyRes.json();
      const cameraNames = config?.cameras ? Object.keys(config.cameras) : [];
      results.verifyAfterPush = {
        ok: true,
        camerasInFrigate: cameraNames,
      };
    } else {
      results.verifyAfterPush = {
        ok: false,
        status: verifyRes.status,
      };
    }
  } catch (err) {
    results.verifyAfterPush = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json(results);
}
