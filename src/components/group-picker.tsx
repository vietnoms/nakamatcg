"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "./ui";

export type GroupOption = { id: string; name: string };

/**
 * The page's group filter, kept in the address (?group=<id>, "none" for cards in no group) so a
 * reload or a shared link keeps it. Changing it reloads the page's data for that group.
 */
export function GroupPicker({ groups, noneOption = true, className }: { groups: GroupOption[]; noneOption?: boolean; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const value = params.get("group") ?? "";
  if (groups.length === 0) return null;
  return (
    <Select
      aria-label="Group"
      className={className}
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set("group", e.target.value);
        else next.delete("group");
        router.push(`${path}${next.size ? `?${next}` : ""}`);
      }}
    >
      <option value="">All groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
      {noneOption && <option value="none">No group</option>}
    </Select>
  );
}
