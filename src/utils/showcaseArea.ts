// Copyright (C) 2026 dumbapplee
// SPDX-License-Identifier: AGPL-3.0-only

export function ensureShowcaseArea(document: Document): HTMLElement | null {
	const column = document.querySelector<HTMLElement>('.profile_leftcol');
	if (!column) return null;

	const existing = column.querySelector<HTMLElement>(':scope > .profile_customization_area');
	if (existing) {
		column.prepend(existing);
		return existing;
	}

	const area = document.createElement('div');
	area.className = 'profile_customization_area';
	column.prepend(area);
	return area;
}