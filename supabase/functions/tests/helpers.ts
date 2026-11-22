// Scripted fetch for adapter tests: each route returns a canned JSON response and every call is recorded.
export interface Call { url: string; method: string; headers: Headers; body: string }
type Responder = (call: Call) => { status?: number; body: unknown };

export function fakeFetch(routes: [RegExp, Responder][]) {
  const calls: Call[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const call: Call = { url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") };
    calls.push(call);
    const route = routes.find(([re]) => re.test(`${call.method} ${url}`));
    if (!route) return Promise.resolve(new Response(JSON.stringify({ error: "no route" }), { status: 404 }));
    const r = route[1](call);
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } }));
  };
  return { fetch: fn as typeof fetch, calls };
}

export const formOf = (body: string) => Object.fromEntries(new URLSearchParams(body).entries());
