import { useEffect, useState } from "react";

interface Result<T> { data: T | null; error: { message: string } | null }
interface State<T> { data: T | null; error: string | null; loading: boolean; key: string }

/**
 * Loads data whenever `key` changes (or reload() is called). State is only set from the promise
 * callback, never synchronously inside the effect.
 */
export function useQuery<T>(key: string, fn: () => PromiseLike<Result<T>>) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true, key: "" });
  const want = `${key}#${tick}`;
  useEffect(() => {
    let alive = true;
    Promise.resolve(fn()).then(
      (r) => alive && setState({ data: r.data, error: r.error?.message ?? null, loading: false, key: want }),
      (e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false, key: want }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);
  return { ...state, loading: state.key !== want, reload: () => setTick((t) => t + 1) };
}
