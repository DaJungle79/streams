import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { setStoreRoot, storeRoot } from "../../storage/repository";

/**
 * Where the store lives (SPEC §6).
 *
 * Pointing this at a sync folder is the whole of "turning on sync" — there is no
 * server, no account, and no protocol. That was the point of the JSON-files
 * decision.
 */
export function StoreFolder() {
  const [root, setRoot] = useState<string | null>(null);

  useEffect(() => {
    void storeRoot().then(setRoot);
  }, []);

  const choose = async () => {
    const picked = await openDialog({
      directory: true,
      title: "Choose a folder for your Streams store",
    });
    if (typeof picked !== "string") return;

    await setStoreRoot(picked);
    // The store is read once at boot and held in memory, so a new root means a
    // reload. Simpler and safer than trying to swap the store underneath a live
    // view — and it's a once-a-year action.
    window.location.reload();
  };

  if (root === null) return null;

  return (
    <div className="storefolder">
      <p className="sidebar-hint">Store</p>
      <p className="storefolder-path" title={root}>
        {root.replace(/^\/Users\/[^/]+/, "~")}
      </p>
      <button className="chip" onClick={() => void choose()}>
        Change folder…
      </button>
      <p className="sidebar-hint">
        Point this at a sync folder to share across Macs. Add <code>/.tmp</code> to its ignore
        list.
      </p>
    </div>
  );
}
