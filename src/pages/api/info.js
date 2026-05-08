export const prerender = false;

export async function GET() {
  try {
    const res = await fetch("http://185.107.96.148:3000/query");
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ status: "offline", reason: "fetch-failed" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
