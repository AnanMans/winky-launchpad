// src/app/page.tsx (Server Component by default)
import CurveActions from "@/components/CurveActions"; // ✅ direct import

export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-4">Curve demo</h1>
      <CurveActions /> {/* ✅ This is a Client Component; fine to render here */}
    </main>
  );
}

