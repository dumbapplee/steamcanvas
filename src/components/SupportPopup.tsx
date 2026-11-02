// Copyright (C) 2026 dumbapplee
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import { Coffee, X } from 'lucide-react';

const supportPopupSeenKey = 'steamcanvas-support-popup-seen';
const supportPopupDelayMs = 2500;

function hasSeenSupportPopup() {
	try {
		return localStorage.getItem(supportPopupSeenKey) === '1';
	} catch {
		return true;
	}
}

function markSupportPopupSeen() {
	try {
		localStorage.setItem(supportPopupSeenKey, '1');
	} catch {
		// Storage can be unavailable (private mode); the popup then simply may show again.
	}
}

export default function SupportPopup() {
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		if (hasSeenSupportPopup()) return;
		const timer = window.setTimeout(() => {
			markSupportPopupSeen();
			dialogRef.current?.showModal();
		}, supportPopupDelayMs);
		return () => window.clearTimeout(timer);
	}, []);

	function closePopup() {
		dialogRef.current?.close();
	}

	return (
		<dialog
			ref={dialogRef}
			className="support-dialog"
			aria-labelledby="support-popup-title"
			onCancel={(event) => { event.preventDefault(); closePopup(); }}
			onClick={(event) => { if (event.target === event.currentTarget) closePopup(); }}
		>
			<div className="support-dialog-content">
				<header className="support-dialog-header">
					<h2 id="support-popup-title">Keep SteamCanvas online</h2>
					<button className="icon-button" type="button" aria-label="Close" onClick={closePopup}><X size={15} /></button>
				</header>
				<p className="support-dialog-body">Hey! =) SteamCanvas is free, but the servers aren't, and they bill us every month just to keep your previews alive. A coffee from you keeps the lights on and the new features coming =P</p>
				<p className="support-dialog-body">No pressure though, the app stays free either way. Thanks for being here =D</p>
				<div className="support-dialog-actions">
									<button type="button" onClick={closePopup}>Maybe later</button>
									<a href="https://buymeacoffee.com/migueelss" target="_blank" rel="noreferrer" onClick={closePopup}><Coffee size={14} /> Buy me a coffee</a>
				</div>
			</div>
		</dialog>
	);
}
