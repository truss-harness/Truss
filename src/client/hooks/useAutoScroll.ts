import { useEffect } from "react";

export function useAutoScroll<TTrigger>(
  ref: React.RefObject<HTMLElement | null>,
  trigger: TTrigger,
): void {
  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [ref, trigger]);
}
