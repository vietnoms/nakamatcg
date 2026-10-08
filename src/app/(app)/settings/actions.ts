"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/guard";
import { getDb } from "@/db/client";
import type { AppSettings, SettingKey } from "@/lib/settings";
import { saveSetting } from "@/server/settings";

export async function saveSettingAction<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<{ error?: string }> {
  await requireSession();
  try {
    await saveSetting(getDb(), key, value);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath("/", "layout");
  return {};
}
