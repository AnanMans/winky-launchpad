import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function CoinsPage() {
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return <div className="p-6 text-red-600">Error loading coins: {error.message}</div>;
  }

  const rows = (data ?? [])
    // keep only rows that have a real mint string
    .filter((c: any) => typeof c.mint === "string" && c.mint.length >= 32);

  // optional: de-duplicate by mint (in case you have dup rows)
  const seen = new Set<string>();
  const coins = rows.filter((c: any) => {
    if (seen.has(c.mint)) return false;
    seen.add(c.mint);
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">Coins</h1>

      {coins.length === 0 && (
        <div className="text-gray-500">No coins yet.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {coins.map((c: any, i: number) => (
          <Link
            key={`${c.mint}-${c.id ?? i}`}  /* ← unique key even if id is null */
            href={`/coin/${encodeURIComponent(c.mint)}`}
            className="rounded-xl border p-4 hover:shadow"
          >
            <div className="flex items-center gap-3">
              {c.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logo_url}
                  alt={c.symbol ?? c.name ?? "token"}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-gray-200" />
              )}
              <div>
                <div className="font-semibold">
                  {c.name ?? "Unnamed"}{" "}
                  <span className="text-gray-500">
                    ({(c.symbol ?? "").toString().toUpperCase()})
                  </span>
                </div>
                <div className="text-xs text-gray-500 break-all">{c.mint}</div>
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Curve: {c.curve ?? "n/a"} · Strength: {c.strength ?? "n/a"}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
