// ==UserScript==
// @name         MWI 角色上次在线
// @namespace    https://milkywayidle.com/
// @version      1.2.0
// @description  在游戏界面列出账号全部角色及距离上次在线的时间。
// @author       ColaCola Stella
// @license      MIT
// @homepageURL  https://github.com/TechLinF/mwi-userscripts
// @supportURL   https://github.com/TechLinF/mwi-userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-character-last-online.user.js
// @updateURL    https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-character-last-online.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    "use strict";

    const API_HOST = location.hostname.includes("milkywayidlecn")
        ? "https://api.milkywayidlecn.com"
        : "https://api.milkywayidle.com";
    const relativeTime = new Intl.RelativeTimeFormat("zh-CN", { numeric: "always" });
    let characters = [];
    let renderQueued = false;
    let offlineCaps = {};
    try { offlineCaps = JSON.parse(localStorage.getItem("mwi-character-offline-caps") || "{}"); } catch (_) { /* reset below */ }

    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
            super(...args);
            this.addEventListener("message", event => {
                if (typeof event.data !== "string") return;
                try {
                    const message = JSON.parse(event.data);
                    const id = message.character?.id;
                    const cap = Number(message.characterInfo?.offlineHourCap);
                    if (message.type === "init_character_data" && id && cap > 0) {
                        offlineCaps[id] = cap;
                        localStorage.setItem("mwi-character-offline-caps", JSON.stringify(offlineCaps));
                        scheduleRender();
                    }
                } catch (_) { /* 非 JSON 消息 */ }
            });
        }
    }; 

    function formatAgo(lastOfflineTime) {
        const milliseconds = Date.now() - new Date(lastOfflineTime).getTime();
        if (!Number.isFinite(milliseconds) || milliseconds < 0) return "刚刚";

        const units = [
            ["year", 365 * 24 * 60 * 60 * 1000],
            ["month", 30 * 24 * 60 * 60 * 1000],
            ["day", 24 * 60 * 60 * 1000],
            ["hour", 60 * 60 * 1000],
            ["minute", 60 * 1000]
        ];
        const [unit, size] = units.find(([, size]) => milliseconds >= size) || ["second", 1000];
        return relativeTime.format(-Math.max(1, Math.floor(milliseconds / size)), unit);
    }

    function status(character) {
        return character.isOnline ? "当前在线" : formatAgo(character.lastOfflineTime);
    }

    function offlineProgress(character) {
        const cap = Number(offlineCaps[character.id]) || 10;
        const elapsed = character.isOnline ? 0 : Math.max(0, Date.now() - new Date(character.lastOfflineTime).getTime());
        return { cap, percent: Math.min(100, Math.floor(elapsed / (cap * 36e5) * 100)) };
    }

    function renderGamePanel() {
        let widget = document.getElementById("mwi-character-last-online-widget");
        if (location.pathname !== "/game") {
            widget?.remove();
            return;
        }
        if (!document.body || !characters.length) return;

        if (!widget) {
            widget = document.createElement("div");
            widget.id = "mwi-character-last-online-widget";
            widget.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;font:14px/1.5 Roboto,sans-serif";
            widget.innerHTML = `<div id="mwi-character-last-online-panel" hidden style="min-width:230px;margin-bottom:6px;padding:10px 12px;border:1px solid #52658f;border-radius:8px;background:rgba(19,28,55,.95);box-shadow:0 4px 18px #0008;color:#e7ecff"></div><button type="button" style="float:right;padding:7px 11px;border:1px solid #52658f;border-radius:7px;background:#26375f;color:#fff;cursor:pointer">角色在线</button>`;
            widget.querySelector("button").addEventListener("click", () => {
                const panel = widget.querySelector("#mwi-character-last-online-panel");
                panel.hidden = !panel.hidden;
            });
            document.body.append(widget);
        }

        const panel = widget.querySelector("#mwi-character-last-online-panel");
        const currentId = new URLSearchParams(location.search).get("characterId");
        const html = `<div style="margin-bottom:6px;font-weight:700;color:#fff">账号角色（${characters.length}）</div>` + characters.map(character => {
            const online = character.isOnline;
            const current = String(character.id) === currentId;
            const time = character.lastOfflineTime ? new Date(character.lastOfflineTime).toLocaleString("zh-CN") : "未知";
            const progress = offlineProgress(character);
            return `<div title="上次离线：${time}" style="padding:4px 0;${current ? "font-weight:700" : ""}"><div style="display:flex;justify-content:space-between;gap:16px"><span>${escapeHtml(character.name)}${current ? "（当前）" : ""}</span><span style="color:${online ? "#77dd77" : "#ffd166"}">${status(character)}</span></div><div style="display:flex;align-items:center;gap:7px;font-size:11px;font-weight:400;color:#aebce0"><div style="height:5px;flex:1;overflow:hidden;border-radius:3px;background:#10182d"><div style="width:${progress.percent}%;height:100%;background:${progress.percent >= 100 ? "#ff7070" : "#69a7ff"}"></div></div><span>收益 ${progress.percent}% / <input data-character-id="${character.id}" value="${progress.cap}" type="number" min="1" max="999" title="该角色的离线收益上限（小时），可在设置中查看" style="width:38px;padding:0 2px;border:1px solid #52658f;border-radius:3px;background:#10182d;color:#fff;text-align:center">小时</span></div></div>`;
        }).join("");
        if (panel.innerHTML !== html) {
            panel.innerHTML = html;
            for (const input of panel.querySelectorAll("input[data-character-id]")) {
                input.addEventListener("change", () => {
                    offlineCaps[input.dataset.characterId] = Math.max(1, Number(input.value) || 10);
                    localStorage.setItem("mwi-character-offline-caps", JSON.stringify(offlineCaps));
                    scheduleRender();
                });
            }
        }
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[character]);
    }

    function renderCharacterCards() {
        if (location.pathname !== "/characterSelect" || !characters.length) return;

        for (const slot of document.querySelectorAll('a[href*="/game?characterId="]')) {
            const id = new URL(slot.href, location.href).searchParams.get("characterId");
            const character = characters.find(item => String(item.id) === id);
            if (!character) continue;

            let label = slot.querySelector(".mwi-last-online-ago");
            if (!label) {
                label = document.createElement("div");
                label.className = "mwi-last-online-ago";
                label.style.cssText = "margin-top:4px;color:#ffd166;font-size:14px;font-weight:600;text-align:center";
                slot.append(label);
            }
            const text = character.isOnline ? "当前在线" : `距今：${formatAgo(character.lastOfflineTime)}`;
            if (label.textContent !== text) label.textContent = text;
            label.title = character.lastOfflineTime
                ? `上次离线：${new Date(character.lastOfflineTime).toLocaleString("zh-CN")}`
                : "";
        }
    }

    function render() {
        renderQueued = false;
        renderGamePanel();
        renderCharacterCards();
    }

    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(render);
    }

    async function loadCharacters() {
        if (!/^\/(game|characterSelect)$/.test(location.pathname)) return;
        try {
            const response = await fetch(`${API_HOST}/v1/characters`, { credentials: "include" });
            if (!response.ok) return;
            characters = (await response.json()).characters || [];
            scheduleRender();
        } catch (_) {
            // 游戏自身会显示网络错误；脚本静默等待下次刷新。
        }
    }

    function routeChanged() {
        scheduleRender();
        loadCharacters();
    }

    for (const method of ["pushState", "replaceState"]) {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            queueMicrotask(routeChanged);
            return result;
        };
    }
    addEventListener("popstate", routeChanged);

    const start = () => {
        new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
        routeChanged();
        setInterval(scheduleRender, 60 * 1000);
        setInterval(loadCharacters, 5 * 60 * 1000);
    };
    document.documentElement ? start() : addEventListener("DOMContentLoaded", start, { once: true });
})();
