"use client";

import { useEffect } from "react";

function getValidFontScale(raw: number | undefined) {
	if (raw === undefined || Number.isNaN(raw)) {
		return 100;
	}
	return Math.min(125, Math.max(85, raw));
}

export function AppFontScaleSync() {
	useEffect(() => {
		const applyFontScale = (nextScale: number) => {
			document.documentElement.style.fontSize = `${nextScale}%`;
		};

		void (async () => {
			try {
				const res = await fetch("/api/preferences", { cache: "no-store" });
				if (!res.ok) return;
				const json = (await res.json()) as { data?: { fontScale?: number } };
				applyFontScale(getValidFontScale(json.data?.fontScale));
			} catch {
				applyFontScale(100);
			}
		})();
	}, []);

	return null;
}
