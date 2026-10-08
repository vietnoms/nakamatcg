import { ImportClient } from "./import-client";

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Import from Collectr</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Export your portfolio as CSV in Collectr, then choose the file here. Nothing is saved until you press Import.
          Importing again later updates market prices and adds only new copies.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
