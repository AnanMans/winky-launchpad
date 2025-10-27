import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import CurveActions from "@/components/CurveActions";

export const dynamic = "force-dynamic";

export default async function CoinDetail({
  params,
}: {
  params: { mint: string };
}) {
  const mint = decodeURIComponent(params.mint);

  // Use maybeSingle() to avoid the "Cannot coerce..." error
  const { data, error } = await supabaseAdmin
    .from("coins")
    .select("*")
    .eq("mint", mint)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <Link href="/coins" className="text-blue-600 underline">← Back to coins</Link>
        <div className="text-red-600">Error: {error.message}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <Link href="/coins" className="text-blue-600 underline">← Back to coins</Link>
        <div className="text-gray-700">Coin not found for mint: {mint}</div>
      </div>
    );
  }

  const c = data;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <Link href="/coins" className="text-blue-600 underline">← Back to coins</Link>

      <div className="flex items-center gap-4">
        {c.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.logo_url} alt={c.symbol} className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-gray-200" />
        )}
        <div>
          <h1 className="text-2xl font-bold">
            {c.name} <span className="text-gray-500">({c.symbol})</span>
          </h1>
          <div className="text-xs text-gray-500 break-all">{c.mint}</div>
        </div>
      </div>

      {c.description && <p className="text-gray-700">{c.description}</p>}

      {c.socials && (
        <div className="flex flex-wrap gap-3 text-sm">
          {c.socials.x && (
            <a className="text-blue-600 underline" href={c.socials.x} target="_blank">X</a>
          )}
          {c.socials.telegram && (
            <a className="text-blue-600 underline" href={c.socials.telegram} target="_blank">Telegram</a>
          )}
          {c.socials.website && (
            <a className="text-blue-600 underline" href={c.socials.website} target="_blank">Website</a>
          )}
        </div>
      )}

      <div className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Trade</h2>
        {/* Reuse your working buy/sell wired to THIS mint */}
        <CurveActions mintOverride={mint} />
      </div>
    </div>
  );
}
