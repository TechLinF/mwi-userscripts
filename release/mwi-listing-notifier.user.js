// ==UserScript==
// @name         MWI 挂牌成交提醒与升级成本
// @name:en      MWI Listing Fill Alerts & Upgrade Costs
// @namespace    https://github.com/TechLinF/mwi-userscripts
// @version      1.1.12
// @description  自己的市场卖单或收购单成交时在页面提示，并显示房屋和神龛升级材料成本。
// @description:en  Shows listing fills and estimated material costs for house and shrine upgrades.
// @author       ColaCola Stella
// @contributor  柆雨
// @license      MIT
// @homepageURL  https://github.com/TechLinF/mwi-userscripts
// @supportURL   https://github.com/TechLinF/mwi-userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-listing-notifier.user.js
// @updateURL    https://raw.githubusercontent.com/TechLinF/mwi-userscripts/main/release/mwi-listing-notifier.user.js
// @match        https://www.milkywayidle.com/*
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @match        https://milkywayidlecn.com/*
// @icon         https://www.milkywayidle.com/favicon.svg
// @grant        unsafeWindow
// @grant        GM_addElement
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * Upgrade-cost portions are adapted from Milky Way Idle Guild Assistant:
 * https://github.com/LaYuDr/milky-way-idle-guild-credit-optimizer
 *
 * MIT License
 * Copyright (c) 2026 柆雨
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(function () {
    "use strict";

    const VERSION = "1.1.12";
    const PAGE_WINDOW = typeof unsafeWindow === "object" ? unsafeWindow : window;
    const GAME_WS_HOSTS = new Set([
        "api.milkywayidle.com",
        "api-test.milkywayidle.com",
        "api.milkywayidlecn.com",
        "api-test.milkywayidlecn.com"
    ]);
    const listingSnapshots = new Map();
    const originalFavicons = new Map();
    let characterId = "";
    let hasInitialListings = false;
    let unread = false;

    const upgradeCostState = {
        itemDetails: null,
        guildBuffDetails: null,
        characterItems: null,
        marketPrices: null,
        marketQuotes: null,
        liveMarketQuotes: null,
        marketSnapshot: null,
        marketSnapshotTimestamp: 0,
        marketSnapshotFetchedAt: 0,
        marketSnapshotPromise: null,
        marketStateHydrated: false,
        marketSnapshotForbiddenUntilByOrigin: Object.create(null),
        marketSnapshotCandidateSignature: "",
        marketSnapshotCandidateTimestamp: 0,
        marketSnapshotCandidateConfirmations: 0,
        marketLiveData: Object.create(null),
        marketLiveRevision: 0,
        marketBridgeRevision: 0,
        marketUpdateSignatures: Object.create(null),
        marketDomObserver: null,
        marketDomScanScheduled: false,
        lastMarketDomSignature: "",
        marketFetchedAt: 0,
        marketPromise: null,
        marketError: false,
        rootObserver: null,
        modalObserver: null,
        observedModal: null,
        refreshTimer: null,
        refreshId: 0,
        characterItemsRevision: 0,
        lastError: "",
        lastSyncAt: 0,
        lastRefreshAt: 0,
        lastModalReason: ""
    };
    let nativeGuildBuffRootObserver = null;
    let nativeGuildBuffModalObserver = null;
    let nativeGuildBuffObservedModal = null;
    let nativeGuildBuffRefreshTimer = null;
    let nativeGuildBuffRefreshId = 0;
    const nativeGuildBuffCostState = {
        box: null,
        drag: null,
        position: null,
        positionInitialized: false
    };
    const houseUpgradeCostState = {
        box: null,
        drag: null,
        position: null,
        positionInitialized: false
    };
    let nativeGuildBuffCostResizeHandler = null;

    const SHRINE_NAMES = {
        "/guild_shrines/tempo": "节奏神龛",
        "/guild_shrines/spirit": "精神神龛",
        "/guild_shrines/force": "力量神龛",
        "/guild_shrines/rarity": "稀有神龛",
        "/guild_shrines/scholar": "学者神龛"
    };
    const ITEM_NAMES = {
        "/items/coin": "金币",
        "/items/guild_token": "公会代币",
        "/items/green_guild_credit": "绿色公会信用点",
        "/items/brown_guild_credit": "棕色公会信用点",
        "/items/white_guild_credit": "白色公会信用点",
        "/items/blue_guild_credit": "蓝色公会信用点",
        "/items/purple_guild_credit": "紫色公会信用点",
        "/items/red_guild_credit": "红色公会信用点",
        "/items/silver_guild_credit": "银色公会信用点",
        "/items/gold_guild_credit": "金色公会信用点"
    };
    const CREDIT_HRIDS = new Set(Object.keys(ITEM_NAMES).filter(item => item.endsWith("_guild_credit")));
    // These token exchange rates and purchase-route overrides are intentionally fixed.
    // Update them if the game changes its guild exchange rules.
    const GUILD_TOKEN_CREDIT_CONVERSIONS = [
        { creditItemHrid: "/items/green_guild_credit", guildTokenCount: 1, creditCount: 10 },
        { creditItemHrid: "/items/brown_guild_credit", guildTokenCount: 1, creditCount: 10 },
        { creditItemHrid: "/items/white_guild_credit", guildTokenCount: 1, creditCount: 10 },
        { creditItemHrid: "/items/blue_guild_credit", guildTokenCount: 1, creditCount: 10 },
        { creditItemHrid: "/items/purple_guild_credit", guildTokenCount: 1, creditCount: 1 },
        { creditItemHrid: "/items/red_guild_credit", guildTokenCount: 1, creditCount: 1 },
        { creditItemHrid: "/items/silver_guild_credit", guildTokenCount: 10, creditCount: 1 },
        { creditItemHrid: "/items/gold_guild_credit", guildTokenCount: 60, creditCount: 1 }
    ];
    const NATIVE_CREDIT_PURCHASE_ITEM_OVERRIDES = {
        "/items/purple_guild_credit": "/items/red_culinary_hat"
    };
    const NATIVE_CREDIT_GUILD_TOKEN_OVERRIDES = new Set(["/items/gold_guild_credit"]);
    const NATIVE_PRICE_REFERENCE_STORAGE_KEY = "mwi-credit-price-reference";
    const NATIVE_GUILD_BUFF_COST_STYLE_ID = "mwi-listing-native-guild-buff-cost-styles";
    const HOUSE_UPGRADE_COST_STYLE_ID = "mwi-listing-house-upgrade-cost-styles";
    const HOUSE_UPGRADE_COST_CLASS = "mwi-listing-house-upgrade-cost";
    const MARKET_LIVE_STORAGE_KEY = "mwi-guild-credit-live-market-v1";
    const MARKET_SNAPSHOT_STORAGE_KEY = "mwi-guild-credit-market-snapshot-v1";
    const MARKET_REQUEST_STORAGE_KEY = "mwi-guild-credit-market-request-v1";
    const GUILD_CREDIT_SOCKET_MESSAGE_EVENT = "__mwiGuildCreditSocketMessageV1";
    const GUILD_CREDIT_SOCKET_READY_EVENT = "__mwiGuildCreditSocketReadyV1";
    const MARKETPLACE_SNAPSHOT_PATH = "/game_data/marketplace.json";
    const MARKETPLACE_SNAPSHOT_ORIGINS = [
        "https://www.milkywayidle.com",
        "https://www.milkywayidlecn.com",
        "https://q7.nainai.eu.org"
    ];
    const MARKETPLACE_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
    const MARKETPLACE_SNAPSHOT_REFRESH_COOLDOWN_MS = 60 * 1000;
    const MARKETPLACE_SNAPSHOT_FORBIDDEN_BACKOFF_MS = 10 * 60 * 1000;
    const SHRINE_NAME_KEYS = {
        "/guild_shrines/force": "shrineForce",
        "/guild_shrines/tempo": "shrineTempo",
        "/guild_shrines/spirit": "shrineSpirit",
        "/guild_shrines/rarity": "shrineRarity",
        "/guild_shrines/scholar": "shrineScholar"
    };
    const NATIVE_STRINGS = {
        "zh-CN": {
            shrineForce: "力量神龛",
            shrineTempo: "节奏神龛",
            shrineSpirit: "精神神龛",
            shrineRarity: "稀有神龛",
            shrineScholar: "学者神龛",
            shrineWithDomain: "{shrine}（{domain}）",
            domainLife: "生活",
            domainCombat: "战斗",
            priceReferenceA: "左一",
            priceReferenceB: "右一",
            priceReferenceCostNoteA: "左一成本按当前最低卖价估算，未计入档位数量和吃单滑点。",
            priceReferenceCostNoteB: "右一是挂单理论成本，不保证成交。",
            nativeUpgradeCostTitle: "预计总花费（{reference}）",
            nativeUpgradeFullCost: "材料完整成本",
            nativeUpgradeAdditionalCost: "扣除库存后还需",
            nativeUpgradePureTokenCost: "纯代币完整总需",
            nativeUpgradePureTokenMissing: "纯代币扣除库存还需",
            nativeUpgradePurchasePlan: "信用点采购明细",
            nativeUpgradePureTokenPlan: "信用点代币兑换明细（纯代币方案）",
            nativeUpgradeBaseTokens: "公会代币（基础消耗）",
            nativeUpgradeBaseTokenDirect: "基础消耗",
            nativeUpgradeNeedQuantity: "需 {count}",
            nativeUpgradeMissingQuantity: "缺 {count}",
            pureTokenSummaryLabel: "纯使用代币总计",
            pureTokenTotalSummary: "{count}",
            pureTokenPlanMissingSummary: "扣除库存还需 {count}",
            nativeUpgradePurchaseQuantity: "购买 {count}",
            nativeUpgradeUnitPrice: "单价 {price}",
            nativeUpgradeLineTotal: "总价 {total}",
            nativeUpgradeTokenExchangeQuantity: "兑换 {count}",
            nativeUpgradeTokenExchangeCost: "需 {count} 公会代币",
            nativeUpgradeNoCreditPurchase: "信用点库存已覆盖，无需采购。",
            nativeUpgradeCreditUnpriced: "暂无可用市场价格",
            nativeUpgradeCalculating: "正在读取市场价格并计算...",
            nativeUpgradeUnavailable: "暂时无法计算，请刷新游戏后重试。",
            gold: "金币",
            guildTokens: "公会代币",
            exchangeRate: "{items} → {credits}",
            itemQuantity: "{count} 个",
            creditQuantity: "{count} 点"
        },
        en: {
            shrineForce: "Force Shrine",
            shrineTempo: "Tempo Shrine",
            shrineSpirit: "Spirit Shrine",
            shrineRarity: "Rarity Shrine",
            shrineScholar: "Scholar Shrine",
            shrineWithDomain: "{shrine} ({domain})",
            domainLife: "Life",
            domainCombat: "Combat",
            priceReferenceA: "Lowest ask",
            priceReferenceB: "Highest bid",
            priceReferenceCostNoteA: "Lowest-ask cost excludes order-book depth and purchase slippage.",
            priceReferenceCostNoteB: "Highest-bid cost is theoretical and does not guarantee fills.",
            nativeUpgradeCostTitle: "Estimated total cost ({reference})",
            nativeUpgradeFullCost: "Full material cost",
            nativeUpgradeAdditionalCost: "Still needed after inventory",
            nativeUpgradePureTokenCost: "Pure tokens full cost",
            nativeUpgradePureTokenMissing: "Pure tokens needed after inventory",
            nativeUpgradePurchasePlan: "Credit purchase details",
            nativeUpgradePureTokenPlan: "Credit token exchange (Pure tokens)",
            nativeUpgradeBaseTokens: "Guild Tokens (Base Cost)",
            nativeUpgradeBaseTokenDirect: "Base cost",
            nativeUpgradeNeedQuantity: "Need {count}",
            nativeUpgradeMissingQuantity: "missing {count}",
            pureTokenSummaryLabel: "Pure token total",
            pureTokenTotalSummary: "{count}",
            pureTokenPlanMissingSummary: "needed {count}",
            nativeUpgradePurchaseQuantity: "Buy {count}",
            nativeUpgradeUnitPrice: "Unit {price}",
            nativeUpgradeLineTotal: "Total {total}",
            nativeUpgradeTokenExchangeQuantity: "Exchange {count}",
            nativeUpgradeTokenExchangeCost: "Needs {count} guild tokens",
            nativeUpgradeNoCreditPurchase: "Credit inventory already covers the requirement.",
            nativeUpgradeCreditUnpriced: "No usable market price",
            nativeUpgradeCalculating: "Reading market prices and calculating...",
            nativeUpgradeUnavailable: "Cost is temporarily unavailable. Refresh the game and try again.",
            gold: "Gold",
            guildTokens: "guild tokens",
            exchangeRate: "{items} → {credits}",
            itemQuantity: "{count} items",
            creditQuantity: "{count} credits"
        }
    };

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[character]));
    }

    function nativeLocale() {
        const candidates = [];
        try {
            candidates.push(
                PAGE_WINDOW.i18next?.resolvedLanguage,
                PAGE_WINDOW.i18next?.language,
                PAGE_WINDOW.i18n?.resolvedLanguage,
                PAGE_WINDOW.i18n?.language,
                PAGE_WINDOW.localStorage?.getItem("i18nextLng")
            );
        } catch (error) { /* Optional game locale state. */ }
        candidates.push(document.documentElement?.lang);
        for (const candidate of candidates) {
            if (/^zh(?:-|$)/i.test(String(candidate || "").trim())) return "zh-CN";
            if (/^en(?:-|$)/i.test(String(candidate || "").trim())) return "en";
        }
        return "zh-CN";
    }

    function nativeText(key, values) {
        const strings = NATIVE_STRINGS[nativeLocale()] || NATIVE_STRINGS["zh-CN"];
        const template = strings[key] || NATIVE_STRINGS.en[key] || key;
        return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => (
            values && values[name] !== undefined ? String(values[name]) : `{${name}}`
        ));
    }

    function nativeFormatNumber(value, digits) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "-";
        return new Intl.NumberFormat(nativeLocale(), {
            maximumFractionDigits: digits === undefined ? 0 : digits
        }).format(number);
    }

    function nativeCreditQuantity(value) {
        const formatted = nativeFormatNumber(value);
        if (nativeLocale() === "zh-CN") return nativeText("creditQuantity", { count: formatted });
        return `${formatted} ${Number(value) === 1 ? "credit" : "credits"}`;
    }

    function nativePriceReference() {
        try {
            return PAGE_WINDOW.localStorage?.getItem(NATIVE_PRICE_REFERENCE_STORAGE_KEY) === "b" ? "b" : "a";
        } catch (error) {
            return "a";
        }
    }

    function compactNumber(value) {
        const number = toFiniteNumber(value);
        if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}B`;
        if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}M`;
        if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}K`;
        return formatNumber(number);
    }

    function parseCompactNumber(value) {
        const match = String(value || "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
        if (!match) return null;
        const multiplier = ({ K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || "").toUpperCase()] || 1);
        const result = Number(match[1]) * multiplier;
        return Number.isFinite(result) ? result : null;
    }

    function itemHridFromNode(node) {
        if (!node) return "";
        for (const attribute of ["data-item-hrid", "data-hrid", "data-item"] ) {
            const value = node.getAttribute?.(attribute) || node.querySelector?.(`[${attribute}]`)?.getAttribute(attribute);
            if (String(value || "").startsWith("/items/")) return String(value);
        }
        const icon = node.matches?.("svg") ? node : node.querySelector?.("svg");
        const use = icon?.querySelector("use") || node.querySelector?.("use");
        const href = use?.getAttribute("href") || use?.getAttribute("xlink:href") || "";
        const fragment = href.split("#").pop();
        if (fragment && fragment !== href && fragment !== "coin") return `/items/${fragment}`;
        const aria = String(icon?.getAttribute("aria-label") || node.getAttribute?.("aria-label") || "");
        const known = Object.keys(ITEM_NAMES).find(hrid => aria.includes(ITEM_NAMES[hrid]));
        const detailMatch = itemDetailEntries().find(([key, value]) => {
            const name = value?.name || value?.displayName || "";
            return name && aria.includes(String(name));
        });
        return known || detailMatch?.[0] || (fragment === "coin" ? "/items/coin" : "");
    }

    function itemHridFromText(text) {
        const raw = String(text || "");
        return Object.keys(ITEM_NAMES).find(hrid => raw.includes(ITEM_NAMES[hrid]))
            || itemDetailEntries().find(([, detail]) => detail?.name && raw.includes(String(detail.name)))?.[0]
            || "";
    }

    function itemDetailEntries() {
        const source = upgradeCostState.itemDetails;
        if (Array.isArray(source)) {
            return source.map((detail, index) => [detail?.itemHrid || detail?.hrid || String(index), detail]);
        }
        return Object.entries(source || {});
    }

    function itemName(itemHrid, fallback) {
        const id = String(itemHrid || "");
        try {
            const official = PAGE_WINDOW.mwi?.lang?.zh?.translation?.itemNames?.[id];
            if (official) return String(official);
        } catch (error) { /* Optional game dictionary. */ }
        const detail = itemDetailEntries().find(([key, value]) => key === id || value?.itemHrid === id || value?.hrid === id)?.[1];
        if (detail?.name) return String(detail.name);
        if (ITEM_NAMES[id]) return ITEM_NAMES[id];
        if (fallback) return String(fallback);
        return id.replace(/^\/items\//, "").replace(/_/g, " ") || "未知物品";
    }

    function visible(node) {
        const modal = node?.closest?.('[class*="Modal_modal"]') || node;
        if (!modal?.isConnected || modal.hidden || modal.getAttribute("aria-hidden") === "true") return false;
        const rect = modal.getBoundingClientRect();
        const style = PAGE_WINDOW.getComputedStyle?.(modal) || getComputedStyle(modal);
        const opacity = Number(style.opacity);
        return rect.width > 0
            && rect.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.pointerEvents !== "none"
            && (!Number.isFinite(opacity) || opacity > 0.01);
    }

    function mergeUpgradeData(value, depth = 0, seen = new Set()) {
        if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
        seen.add(value);
        const itemDetails = value.itemDetailMap || value.itemDetailDict || value.itemDetails;
        const guildBuffDetails = value.guildBuffDetailMap || value.guildBuffDetailDict || value.guildBuffDetails;
        const characterItems = value.characterItems || value.character?.items;
        const endCharacterItems = value.endCharacterItems;
        if (itemDetails && typeof itemDetails === "object") upgradeCostState.itemDetails = itemDetails;
        if (guildBuffDetails && typeof guildBuffDetails === "object") upgradeCostState.guildBuffDetails = guildBuffDetails;
        if (Array.isArray(characterItems)) upgradeCostState.characterItems = characterItems;
        if (Array.isArray(endCharacterItems) && endCharacterItems.length) {
            const itemKey = item => [
                item?.itemHrid,
                item?.itemLocationHrid,
                item?.itemInstanceHrid,
                item?.itemHash,
                item?.enhancementLevel
            ].map(part => String(part ?? "")).join("|");
            const itemMap = new Map((upgradeCostState.characterItems || []).map(item => [itemKey(item), item]));
            for (const item of endCharacterItems) {
                const key = itemKey(item);
                if (!key.replace(/\|/g, "")) continue;
                if (Number(item?.count) === 0) itemMap.delete(key);
                else itemMap.set(key, item);
            }
            upgradeCostState.characterItems = [...itemMap.values()];
        }
        for (const child of Object.values(value)) mergeUpgradeData(child, depth + 1, seen);
    }

    function decompressFromUtf16(compressed) {
        if (compressed == null || compressed === "") return "";
        const dictionary = [0, 1, 2];
        let next;
        let enlargeIn = 4;
        let dictionarySize = 4;
        let numBits = 3;
        let entry = "";
        const result = [];
        let dataValue = compressed.charCodeAt(0) - 32;
        let dataPosition = 16384;
        let dataIndex = 1;
        const readBits = count => {
            let value = 0;
            let bit = 1;
            for (let power = 1, maxPower = 1 << count; power !== maxPower; power <<= 1) {
                const residue = dataValue & dataPosition;
                dataPosition >>= 1;
                if (dataPosition === 0) {
                    dataPosition = 16384;
                    dataValue = dataIndex < compressed.length ? compressed.charCodeAt(dataIndex) - 32 : 0;
                    dataIndex += 1;
                }
                if (residue > 0) value |= bit;
                bit <<= 1;
            }
            return value;
        };
        const firstToken = readBits(2);
        if (firstToken === 0) entry = String.fromCharCode(readBits(8));
        else if (firstToken === 1) entry = String.fromCharCode(readBits(16));
        else return "";
        dictionary[3] = entry;
        let previous = entry;
        result.push(entry);
        while (true) {
            if (dataIndex > compressed.length) return "";
            const token = readBits(numBits);
            if (token === 0) {
                dictionary[dictionarySize] = String.fromCharCode(readBits(8));
                dictionarySize += 1;
                enlargeIn -= 1;
                next = dictionarySize - 1;
            } else if (token === 1) {
                dictionary[dictionarySize] = String.fromCharCode(readBits(16));
                dictionarySize += 1;
                enlargeIn -= 1;
                next = dictionarySize - 1;
            } else if (token === 2) return result.join("");
            else next = token;
            if (enlargeIn === 0) {
                enlargeIn = 1 << numBits;
                numBits += 1;
            }
            if (dictionary[next]) entry = dictionary[next];
            else if (next === dictionarySize) entry = previous + previous.charAt(0);
            else return "";
            result.push(entry);
            dictionary[dictionarySize] = previous + entry.charAt(0);
            dictionarySize += 1;
            enlargeIn -= 1;
            previous = entry;
            if (enlargeIn === 0) {
                enlargeIn = 1 << numBits;
                numBits += 1;
            }
        }
    }

    function setUpgradeDataFrom(value) {
        if (!value || typeof value !== "object") return false;
        const before = [upgradeCostState.itemDetails, upgradeCostState.guildBuffDetails, upgradeCostState.characterItems];
        const itemDetails = value.itemDetailMap || value.itemDetailDict || value.itemDetails;
        const guildBuffDetails = value.guildBuffDetailMap || value.guildBuffDetailDict || value.guildBuffDetails;
        const characterItems = value.characterItems || value.character?.items;
        if (itemDetails && typeof itemDetails === "object") upgradeCostState.itemDetails = itemDetails;
        if (guildBuffDetails && typeof guildBuffDetails === "object") upgradeCostState.guildBuffDetails = guildBuffDetails;
        if (Array.isArray(characterItems)) upgradeCostState.characterItems = characterItems;
        return before[0] !== upgradeCostState.itemDetails
            || before[1] !== upgradeCostState.guildBuffDetails
            || before[2] !== upgradeCostState.characterItems;
    }

    function hydrateLocalInitData() {
        let raw;
        try { raw = PAGE_WINDOW.localStorage?.getItem("initClientData"); }
        catch (error) { return false; }
        if (!raw) return false;
        try {
            const decoded = decompressFromUtf16(raw);
            let data;
            try { data = JSON.parse(decoded || raw); }
            catch (error) { data = JSON.parse(raw); }
            const before = [upgradeCostState.itemDetails, upgradeCostState.guildBuffDetails, upgradeCostState.characterItems];
            if (!upgradeCostState.itemDetails) upgradeCostState.itemDetails = data.itemDetailMap || data.itemDetailDict;
            if (!upgradeCostState.guildBuffDetails) upgradeCostState.guildBuffDetails = data.guildBuffDetailMap || data.guildBuffDetailDict;
            if (!upgradeCostState.characterItems) upgradeCostState.characterItems = data.characterItems || data.character?.items;
            return before[0] !== upgradeCostState.itemDetails
                || before[1] !== upgradeCostState.guildBuffDetails
                || before[2] !== upgradeCostState.characterItems;
        } catch (error) {
            return false;
        }
    }

    function extractUpgradeDataFromReact() {
        const roots = [document.getElementById("root"), document.body].filter(Boolean);
        const stack = [];
        const visited = new Set();
        for (const root of roots) {
            for (const key of Object.keys(root)) {
                if (key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$") || key.startsWith("__reactInternalInstance$")) {
                    stack.push(root[key]);
                }
            }
        }
        let scanned = 0;
        let found = false;
        while (stack.length && scanned < 6000) {
            const fiber = stack.pop();
            if (!fiber || typeof fiber !== "object" || visited.has(fiber)) continue;
            visited.add(fiber);
            scanned += 1;
            const state = fiber.stateNode?.state;
            for (const candidate of [fiber.memoizedProps, fiber.pendingProps, state, fiber.memoizedState]) {
                if (!candidate || typeof candidate !== "object") continue;
                found = setUpgradeDataFrom(candidate) || found;
            }
            if (fiber.current) stack.push(fiber.current);
            if (fiber.stateNode?.current) stack.push(fiber.stateNode.current);
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
            if (upgradeCostState.itemDetails && upgradeCostState.guildBuffDetails) break;
        }
        return found;
    }

    function consumeBridgeMarketData(bridge) {
        if (!bridge || typeof bridge !== "object") return false;
        let changed = false;
        const bridgeRevision = Number(bridge.marketOrderBookRevision);
        if (Number.isSafeInteger(bridgeRevision) && bridgeRevision > upgradeCostState.marketBridgeRevision) {
            const records = Object.values(bridge.marketOrderBooks || {})
                .filter(record => record && Number(record.revision) > upgradeCostState.marketBridgeRevision)
                .sort((left, right) => Number(left.revision) - Number(right.revision));
            for (const record of records) {
                changed = rememberLiveMarketUpdate(record.update, record.receivedAt) || changed;
            }
            upgradeCostState.marketBridgeRevision = bridgeRevision;
        }
        if (Array.isArray(bridge.messages) && bridge.marketObserverActive !== true) {
            const latestMarketUpdates = new Map();
            for (const rawMessage of bridge.messages) {
                try {
                    const message = JSON.parse(rawMessage);
                    if (String(message?.type || "") !== "market_item_order_books_updated") continue;
                    const update = normalizeMarketOrderBooksUpdate(message);
                    if (update) latestMarketUpdates.set(update.itemHrid, update);
                } catch (error) { /* Ignore non-JSON protocol frames. */ }
            }
            for (const update of latestMarketUpdates.values()) {
                changed = rememberLiveMarketUpdate(update) || changed;
            }
        }
        return changed;
    }

    function guildCreditBridge() {
        try {
            return PAGE_WINDOW.__mwiGuildCreditBridge || window.__mwiGuildCreditBridge || null;
        } catch (error) {
            return null;
        }
    }

    function guildCreditOwnsMarketData() {
        try {
            return guildCreditBridge()?.marketObserverActive === true
                || PAGE_WINDOW.WebSocket?.__mwiGuildCreditBridge === true;
        } catch (error) {
            return false;
        }
    }

    function guildCreditSocketFeedAvailable() {
        const bridge = guildCreditBridge();
        return bridge?.diagnostics?.injectionReady === true
            && bridge?.diagnostics?.installMode === "gm_add_element_main_world";
    }

    function syncUpgradeDataFromPage() {
        try {
            const bridge = guildCreditBridge();
            if (bridge) {
                mergeUpgradeData(bridge);
                consumeBridgeMarketData(bridge);
                const characterItemsRevision = Number(bridge.characterItemsRevision);
                if (Number.isSafeInteger(characterItemsRevision) && characterItemsRevision > upgradeCostState.characterItemsRevision) {
                    upgradeCostState.characterItemsRevision = characterItemsRevision;
                    if (Array.isArray(bridge.characterItems)) upgradeCostState.characterItems = bridge.characterItems;
                }
                if (Array.isArray(bridge.messages) && !Number.isSafeInteger(characterItemsRevision)) {
                    for (let index = bridge.messages.length - 1; index >= 0; index -= 1) {
                        try {
                            mergeUpgradeData(JSON.parse(bridge.messages[index]));
                        } catch (error) { /* Ignore protocol frames. */ }
                    }
                }
            }
        } catch (error) { /* Optional bridge. */ }
        try { mergeUpgradeData(PAGE_WINDOW.mwi?.initClientData); } catch (error) { /* Optional game data. */ }
        try { mergeUpgradeData(PAGE_WINDOW.mwi?.gameData); } catch (error) { /* Optional game data. */ }
        extractUpgradeDataFromReact();
        hydrateLocalInitData();
    }

    function inventoryCount(itemHrid) {
        let total = 0;
        for (const item of upgradeCostState.characterItems || []) {
            if (item?.itemHrid !== itemHrid || item.itemLocationHrid !== "/item_locations/inventory") continue;
            total += Math.max(0, toFiniteNumber(item.count));
        }
        return total;
    }

    function normalizeMarketTimestamp(value) {
        if (typeof value !== "number" && typeof value !== "string") return 0;
        const normalized = typeof value === "string" ? value.trim() : value;
        if (normalized === "") return 0;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) {
            const timestamp = numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
            return timestamp > 0 && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : 0;
        }
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function normalizeMarketLevel(value) {
        const level = Number(value);
        return Number.isSafeInteger(level) && level >= 0 ? level : null;
    }

    function normalizeCachedMarketPrice(value) {
        const price = Number(value);
        return Number.isFinite(price) && (price > 0 || price === -1) ? price : null;
    }

    function normalizeTradableMarketPrice(value) {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? price : null;
    }

    function marketLevelValue(values, level) {
        if (!values || typeof values !== "object") return undefined;
        return values[level] ?? values[String(level)];
    }

    function hasMarketLevelValue(values, level) {
        return Boolean(
            values
            && typeof values === "object"
            && (Object.prototype.hasOwnProperty.call(values, level)
                || Object.prototype.hasOwnProperty.call(values, String(level)))
        );
    }

    function marketMetadataFieldValue(levelMap, level, field, fallback) {
        const levelValue = levelMap && levelMap[level];
        if (
            levelValue
            && typeof levelValue === "object"
            && !Array.isArray(levelValue)
            && Object.prototype.hasOwnProperty.call(levelValue, field)
        ) return levelValue[field];
        return levelValue !== undefined && (typeof levelValue !== "object" || levelValue === null)
            ? levelValue
            : fallback;
    }

    function sanitizeMarketData(rawMarketData) {
        const marketData = Object.create(null);
        if (!rawMarketData || typeof rawMarketData !== "object" || Array.isArray(rawMarketData)) return marketData;
        for (const [itemHrid, levelMap] of Object.entries(rawMarketData)) {
            if (!itemHrid.startsWith("/items/") || !levelMap || typeof levelMap !== "object" || Array.isArray(levelMap)) continue;
            const levels = Object.create(null);
            for (const [rawLevel, rawQuote] of Object.entries(levelMap)) {
                const level = normalizeMarketLevel(rawLevel);
                if (level === null || !rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) continue;
                const quote = Object.create(null);
                for (const field of ["a", "b"]) {
                    if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) {
                        quote[field] = -1;
                        continue;
                    }
                    const price = Number(rawQuote[field]);
                    if (Number.isFinite(price)) quote[field] = price;
                }
                if (Object.keys(quote).length) levels[String(level)] = quote;
            }
            if (Object.keys(levels).length) marketData[itemHrid] = levels;
        }
        return marketData;
    }

    function createMarketStructure(marketData) {
        return Object.entries(marketData || {})
            .map(([itemHrid, levelMap]) => [
                itemHrid,
                Object.entries(levelMap || {})
                    .filter(([, quote]) => quote && typeof quote === "object" && !Array.isArray(quote))
                    .map(([level, quote]) => [
                        level,
                        ["a", "b"].filter(field => (
                            Object.prototype.hasOwnProperty.call(quote, field)
                            && Number.isFinite(Number(quote[field]))
                        ))
                    ])
                    .sort((left, right) => left[0].localeCompare(right[0]))
            ])
            .sort((left, right) => left[0].localeCompare(right[0]));
    }

    function countMissingMarketEntries(confirmedMarketData, incomingMarketData) {
        const incomingItems = new Map(createMarketStructure(incomingMarketData));
        let missingCount = 0;
        for (const [itemHrid, confirmedLevels] of createMarketStructure(confirmedMarketData)) {
            const incomingLevels = incomingItems.get(itemHrid);
            if (!incomingLevels) {
                missingCount += 1 + confirmedLevels.reduce((total, [, fields]) => total + 1 + fields.length, 0);
                continue;
            }
            const incomingLevelsByHrid = new Map(incomingLevels);
            for (const [level, confirmedFields] of confirmedLevels) {
                const incomingFields = incomingLevelsByHrid.get(level);
                if (!incomingFields) {
                    missingCount += 1 + confirmedFields.length;
                    continue;
                }
                for (const field of confirmedFields) if (!incomingFields.includes(field)) missingCount += 1;
            }
        }
        return missingCount;
    }

    function edgeMarketPrice(entries, useLowest) {
        if (!Array.isArray(entries)) return null;
        let result = null;
        for (const entry of entries) {
            const price = Number(entry && typeof entry === "object" ? entry.price : entry);
            if (!Number.isFinite(price) || price <= 0) continue;
            if (result === null || (useLowest ? price < result : price > result)) result = price;
        }
        return result === null ? -1 : result;
    }

    function normalizeMarketOrderBooksUpdate(payload) {
        const source = payload && (
            payload.marketItemOrderBooks
            || (payload.data && payload.data.marketItemOrderBooks)
            || payload
        );
        const itemHrid = String(source?.itemHrid || "").trim();
        if (!itemHrid.startsWith("/items/")) return null;

        const hasDirectBook = source && (
            Object.prototype.hasOwnProperty.call(source, "asks")
            || Object.prototype.hasOwnProperty.call(source, "bids")
        );
        let rawBooks = source?.orderBooks;
        if (!rawBooks && hasDirectBook) {
            const level = Object.prototype.hasOwnProperty.call(source, "enhancementLevel")
                ? normalizeMarketLevel(source.enhancementLevel)
                : 0;
            if (level === null) return null;
            rawBooks = { [level]: source };
        }
        if (!rawBooks || typeof rawBooks !== "object" || Array.isArray(rawBooks)) return null;

        const levels = Object.create(null);
        for (const [rawLevel, rawBook] of Object.entries(rawBooks)) {
            const level = normalizeMarketLevel(rawLevel);
            if (level === null || !rawBook || typeof rawBook !== "object" || Array.isArray(rawBook)) continue;
            const quote = Object.create(null);
            if (Object.prototype.hasOwnProperty.call(rawBook, "asks")) quote.a = edgeMarketPrice(rawBook.asks, true);
            if (Object.prototype.hasOwnProperty.call(rawBook, "bids")) quote.b = edgeMarketPrice(rawBook.bids, false);
            const hasMin = Object.prototype.hasOwnProperty.call(rawBook, "priceBandMin")
                || hasMarketLevelValue(source.priceBandMins, level);
            const hasMax = Object.prototype.hasOwnProperty.call(rawBook, "priceBandMax")
                || hasMarketLevelValue(source.priceBandMaxs, level);
            const min = normalizeTradableMarketPrice(rawBook.priceBandMin ?? marketLevelValue(source.priceBandMins, level));
            const max = normalizeTradableMarketPrice(rawBook.priceBandMax ?? marketLevelValue(source.priceBandMaxs, level));
            if (hasMin) quote.min = min ?? -1;
            if (hasMax) quote.max = max ?? -1;
            if (Object.keys(quote).length) levels[String(level)] = quote;
        }
        return Object.keys(levels).length ? { itemHrid, levels } : null;
    }

    const MARKET_ITEM_HRID_PATTERN = /^[a-z0-9_]+$/i;

    function parseCompactMarketValue(value) {
        const normalized = String(value || "").replace(/,/g, "").replace(/\s+/g, "").trim();
        const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([KMBT]?)$/i);
        if (!match) return null;
        const multiplier = ({ "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 })[String(match[2] || "").toUpperCase()];
        const result = Number(match[1]) * multiplier;
        return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
    }

    function marketDomOrderBookEntries(table) {
        const entries = [];
        for (const row of table.querySelectorAll("tbody tr")) {
            const cells = [...row.querySelectorAll("td")];
            if (cells.length < 2) continue;
            const quantity = parseCompactMarketValue(cells[0].textContent);
            const price = parseCompactMarketValue(cells[1].textContent);
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
            entries.push({ price, quantity });
        }
        return entries;
    }

    function marketDomTableSide(table) {
        const actions = [...table.querySelectorAll("button")]
            .map(button => String(button.textContent || "").trim())
            .filter(Boolean);
        if (actions.some(value => ["购买", "Buy"].includes(value))) return "asks";
        if (actions.some(value => ["出售", "Sell"].includes(value))) return "bids";
        const heading = String(table.querySelector("thead")?.textContent || "");
        if (/出售价|Sell Price/i.test(heading)) return "asks";
        if (/收购价|Buy Price/i.test(heading)) return "bids";
        return "";
    }

    function currentMarketIdentity(documentRef) {
        const currentItem = documentRef.querySelector('[class*="MarketplacePanel_currentItem"]');
        if (!currentItem) return null;
        const use = currentItem.querySelector(
            '[class*="Item_itemContainer"] svg[role="img"] use[href*="items_sprite"],' +
            '[class*="Item_itemContainer"] svg[role="img"] use[xlink\\:href*="items_sprite"]'
        );
        const href = use?.getAttribute("href") || use?.getAttribute("xlink:href") || "";
        const fragment = String(href).split("#").pop();
        if (!MARKET_ITEM_HRID_PATTERN.test(fragment)) return null;
        const enhancementNode = currentItem.querySelector('[class*="Item_enhancementLevel"]');
        const enhancementMatch = String(enhancementNode?.textContent || "").match(/\+?(\d+)/);
        const enhancementLevel = enhancementMatch ? Number(enhancementMatch[1]) : 0;
        return {
            itemHrid: `/items/${fragment}`,
            enhancementLevel: Number.isSafeInteger(enhancementLevel) && enhancementLevel >= 0 ? enhancementLevel : 0
        };
    }

    function marketDomTradableRange(documentRef) {
        if (!documentRef || typeof documentRef.querySelectorAll !== "function") return { min: null, max: null };
        for (const node of documentRef.querySelectorAll('[class*="MarketplacePanel_"]')) {
            const text = String(node.textContent || "").replace(/,/g, "");
            const match = text.match(
                /(?:可交易区间|Tradable\s+Range)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?[KMBT]?)\s*(?:-|–|—|~|至|到)\s*([0-9]+(?:\.[0-9]+)?[KMBT]?)/i
            );
            if (!match) continue;
            const min = parseCompactMarketValue(match[1]);
            const max = parseCompactMarketValue(match[2]);
            if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max >= min) return { min, max };
        }
        return { min: null, max: null };
    }

    function readMarketDomSnapshot(documentRef) {
        if (!documentRef || typeof documentRef.querySelector !== "function") return null;
        const identity = currentMarketIdentity(documentRef);
        const booksContainer = documentRef.querySelector('[class*="MarketplacePanel_orderBooksContainer"]');
        if (!identity || !booksContainer) return null;
        const snapshot = {
            ...identity,
            asks: null,
            bids: null,
            priceBandMin: null,
            priceBandMax: null
        };
        const range = marketDomTradableRange(documentRef);
        snapshot.priceBandMin = range.min;
        snapshot.priceBandMax = range.max;
        for (const table of booksContainer.querySelectorAll('table[class*="MarketplacePanel_orderBookTable"]')) {
            const side = marketDomTableSide(table);
            if (side) snapshot[side] = marketDomOrderBookEntries(table);
        }
        if (!Array.isArray(snapshot.asks) && !Array.isArray(snapshot.bids)) return null;
        snapshot.signature = JSON.stringify([snapshot.itemHrid, snapshot.enhancementLevel, snapshot.asks, snapshot.bids]);
        return snapshot;
    }

    function createMarketDomMessage(snapshot) {
        if (!snapshot?.itemHrid) return null;
        const book = {
            itemHrid: snapshot.itemHrid,
            enhancementLevel: snapshot.enhancementLevel
        };
        if (Array.isArray(snapshot.asks)) book.asks = snapshot.asks;
        if (Array.isArray(snapshot.bids)) book.bids = snapshot.bids;
        if (Number.isFinite(snapshot.priceBandMin) && snapshot.priceBandMin > 0) book.priceBandMin = snapshot.priceBandMin;
        if (Number.isFinite(snapshot.priceBandMax) && snapshot.priceBandMax > 0) book.priceBandMax = snapshot.priceBandMax;
        return { type: "market_item_order_books_updated", marketItemOrderBooks: book };
    }

    function applyLiveMarketUpdate(liveData, update, options) {
        if (!liveData || typeof liveData !== "object" || !update) return false;
        const revision = Number(options?.revision);
        const receivedAt = Number(options?.receivedAt);
        if (!Number.isSafeInteger(revision) || revision <= 0 || !Number.isFinite(receivedAt) || receivedAt <= 0) return false;

        const existing = liveData[update.itemHrid] || {};
        const levels = { ...(existing.levels || {}) };
        const revisionByLevel = { ...(existing.revisionByLevel || {}) };
        const receivedAtByLevel = { ...(existing.receivedAtByLevel || {}) };
        const snapshotTimestampByLevel = { ...(existing.snapshotTimestampByLevel || {}) };
        const snapshotConflictDeferredByLevel = { ...(existing.snapshotConflictDeferredByLevel || {}) };
        const snapshotTimestamp = normalizeMarketTimestamp(options?.snapshotTimestamp);
        for (const [level, quote] of Object.entries(levels)) {
            const fieldRevisions = Object.create(null);
            const fieldTimes = Object.create(null);
            const fieldSnapshotTimestamps = Object.create(null);
            const fieldConflictDeferrals = Object.create(null);
            for (const field of ["a", "b"]) {
                if (!Object.prototype.hasOwnProperty.call(quote || {}, field)) continue;
                fieldRevisions[field] = Number(marketMetadataFieldValue(revisionByLevel, level, field, existing.revision));
                fieldTimes[field] = Number(marketMetadataFieldValue(receivedAtByLevel, level, field, existing.receivedAt));
                fieldSnapshotTimestamps[field] = normalizeMarketTimestamp(
                    marketMetadataFieldValue(snapshotTimestampByLevel, level, field, existing.snapshotTimestamp)
                );
                fieldConflictDeferrals[field] = marketMetadataFieldValue(
                    snapshotConflictDeferredByLevel, level, field, false
                ) === true;
            }
            revisionByLevel[level] = fieldRevisions;
            receivedAtByLevel[level] = fieldTimes;
            snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
            snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
        }
        for (const [level, quote] of Object.entries(update.levels || {})) {
            const mergedQuote = { ...(levels[level] || {}) };
            const fieldRevisions = { ...(revisionByLevel[level] || {}) };
            const fieldTimes = { ...(receivedAtByLevel[level] || {}) };
            const fieldSnapshotTimestamps = { ...(snapshotTimestampByLevel[level] || {}) };
            const fieldConflictDeferrals = { ...(snapshotConflictDeferredByLevel[level] || {}) };
            for (const field of ["a", "b"]) {
                if (!Object.prototype.hasOwnProperty.call(quote, field)) continue;
                mergedQuote[field] = quote[field];
                fieldRevisions[field] = revision;
                fieldTimes[field] = receivedAt;
                fieldSnapshotTimestamps[field] = snapshotTimestamp;
                fieldConflictDeferrals[field] = false;
            }
            for (const field of ["min", "max"]) {
                if (!Object.prototype.hasOwnProperty.call(quote, field)) continue;
                const price = normalizeTradableMarketPrice(quote[field]);
                if (price === null) delete mergedQuote[field];
                else mergedQuote[field] = price;
            }
            levels[level] = mergedQuote;
            revisionByLevel[level] = fieldRevisions;
            receivedAtByLevel[level] = fieldTimes;
            snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
            snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
        }
        if (!Object.keys(levels).length) return false;
        liveData[update.itemHrid] = {
            levels,
            revisionByLevel,
            receivedAtByLevel,
            snapshotTimestampByLevel,
            snapshotConflictDeferredByLevel,
            revision,
            receivedAt
        };
        return true;
    }

    function reconcileLiveMarketData(liveData, options) {
        if (!liveData || typeof liveData !== "object") return { changed: false, expired: false };
        const previousTimestamp = normalizeMarketTimestamp(options?.previousSnapshotTimestamp);
        const nextTimestamp = normalizeMarketTimestamp(options?.nextSnapshotTimestamp);
        const snapshotData = options?.snapshotData;
        const coveredRevision = Number(options?.coveredRevision);
        if (nextTimestamp <= 0 || !Number.isSafeInteger(coveredRevision) || coveredRevision < 0) {
            return { changed: false, expired: false };
        }

        let changed = false;
        let expired = false;
        for (const [itemHrid, entry] of Object.entries(liveData)) {
            const levels = { ...((entry && entry.levels) || {}) };
            const revisionByLevel = { ...((entry && entry.revisionByLevel) || {}) };
            const receivedAtByLevel = { ...((entry && entry.receivedAtByLevel) || {}) };
            const snapshotTimestampByLevel = { ...((entry && entry.snapshotTimestampByLevel) || {}) };
            const snapshotConflictDeferredByLevel = { ...((entry && entry.snapshotConflictDeferredByLevel) || {}) };
            const snapshotLevels = snapshotData && snapshotData[itemHrid];
            for (const [level, quote] of Object.entries(levels)) {
                const fieldRevisions = Object.create(null);
                const fieldTimes = Object.create(null);
                const fieldSnapshotTimestamps = Object.create(null);
                const fieldConflictDeferrals = Object.create(null);
                const snapshotQuote = snapshotLevels && snapshotLevels[level];
                for (const field of ["a", "b"]) {
                    if (!Object.prototype.hasOwnProperty.call(quote || {}, field)) continue;
                    const revision = Number(marketMetadataFieldValue(revisionByLevel, level, field, entry.revision));
                    const receivedAt = Number(marketMetadataFieldValue(receivedAtByLevel, level, field, entry.receivedAt));
                    const baselineTimestamp = normalizeMarketTimestamp(marketMetadataFieldValue(
                        snapshotTimestampByLevel,
                        level,
                        field,
                        entry.snapshotTimestamp ?? previousTimestamp
                    ));
                    const conflictWasDeferred = marketMetadataFieldValue(
                        snapshotConflictDeferredByLevel,
                        level,
                        field,
                        false
                    ) === true;
                    const snapshotHasField = Object.prototype.hasOwnProperty.call(snapshotQuote || {}, field);
                    const snapshotMatchesLive = snapshotHasField && Number(snapshotQuote[field]) === Number(quote[field]);
                    const arrivedDuringRequest = Number.isSafeInteger(revision) && revision > coveredRevision;
                    const snapshotIsNewer = nextTimestamp > baselineTimestamp;
                    const shouldDeferConflict = !snapshotMatchesLive
                        && (arrivedDuringRequest || (snapshotIsNewer && !conflictWasDeferred));
                    const isCoveredBySnapshot = snapshotMatchesLive
                        || (!arrivedDuringRequest && snapshotIsNewer && conflictWasDeferred);
                    if (isCoveredBySnapshot) {
                        delete quote[field];
                        changed = true;
                        expired = true;
                        continue;
                    }
                    fieldRevisions[field] = revision;
                    fieldTimes[field] = receivedAt;
                    fieldSnapshotTimestamps[field] = baselineTimestamp <= 0
                        ? nextTimestamp
                        : shouldDeferConflict ? Math.max(baselineTimestamp, nextTimestamp) : baselineTimestamp;
                    fieldConflictDeferrals[field] = shouldDeferConflict || conflictWasDeferred;
                    if (
                        fieldSnapshotTimestamps[field] !== baselineTimestamp
                        || fieldConflictDeferrals[field] !== conflictWasDeferred
                    ) changed = true;
                }
                if (!Object.keys(quote).length) {
                    delete levels[level];
                    delete revisionByLevel[level];
                    delete receivedAtByLevel[level];
                    delete snapshotTimestampByLevel[level];
                    delete snapshotConflictDeferredByLevel[level];
                } else {
                    revisionByLevel[level] = fieldRevisions;
                    receivedAtByLevel[level] = fieldTimes;
                    snapshotTimestampByLevel[level] = fieldSnapshotTimestamps;
                    snapshotConflictDeferredByLevel[level] = fieldConflictDeferrals;
                }
            }
            if (!Object.keys(levels).length) {
                delete liveData[itemHrid];
                continue;
            }
            const revisions = Object.values(revisionByLevel)
                .flatMap(value => Object.values(value || {}))
                .map(Number)
                .filter(Number.isSafeInteger);
            const receivedTimes = Object.values(receivedAtByLevel)
                .flatMap(value => Object.values(value || {}))
                .map(Number)
                .filter(Number.isFinite);
            liveData[itemHrid] = {
                levels,
                revisionByLevel,
                receivedAtByLevel,
                snapshotTimestampByLevel,
                snapshotConflictDeferredByLevel,
                revision: revisions.length ? Math.max(...revisions) : entry.revision,
                receivedAt: receivedTimes.length ? Math.max(...receivedTimes) : entry.receivedAt
            };
        }
        return { changed, expired };
    }

    function restoreLiveMarketData(value) {
        let stored = value;
        try {
            if (typeof stored === "string") stored = JSON.parse(stored);
        } catch (error) {
            return { liveData: Object.create(null), revision: 0, valid: false };
        }
        if (
            !stored
            || typeof stored !== "object"
            || Array.isArray(stored)
            || !new Set([1, 2, 3]).has(stored.schemaVersion)
            || !stored.items
            || typeof stored.items !== "object"
            || Array.isArray(stored.items)
        ) return { liveData: Object.create(null), revision: 0, valid: false };

        const liveData = Object.create(null);
        let revision = 0;
        let itemCount = 0;
        for (const [itemHrid, entry] of Object.entries(stored.items)) {
            if (itemCount >= 2000) break;
            if (!itemHrid.startsWith("/items/") || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            const levels = Object.create(null);
            const revisionByLevel = Object.create(null);
            const receivedAtByLevel = Object.create(null);
            const snapshotTimestampByLevel = Object.create(null);
            const snapshotConflictDeferredByLevel = Object.create(null);
            let levelCount = 0;
            for (const [rawLevel, rawQuote] of Object.entries(entry.levels || {})) {
                if (levelCount >= 101) break;
                const level = normalizeMarketLevel(rawLevel);
                if (level === null || !rawQuote || typeof rawQuote !== "object" || Array.isArray(rawQuote)) continue;
                const quote = Object.create(null);
                const fieldRevisions = Object.create(null);
                const fieldTimes = Object.create(null);
                const fieldSnapshotTimestamps = Object.create(null);
                const fieldConflictDeferrals = Object.create(null);
                for (const field of ["a", "b"]) {
                    if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) continue;
                    const price = normalizeCachedMarketPrice(rawQuote[field]);
                    if (price === null) continue;
                    const levelKey = String(level);
                    const levelRevision = Number(marketMetadataFieldValue(entry.revisionByLevel, levelKey, field, entry.revision));
                    const receivedAt = Number(marketMetadataFieldValue(entry.receivedAtByLevel, levelKey, field, entry.receivedAt));
                    if (!Number.isSafeInteger(levelRevision) || levelRevision <= 0 || !Number.isFinite(receivedAt) || receivedAt <= 0) continue;
                    quote[field] = price;
                    fieldRevisions[field] = levelRevision;
                    fieldTimes[field] = receivedAt;
                    fieldSnapshotTimestamps[field] = normalizeMarketTimestamp(
                        marketMetadataFieldValue(entry.snapshotTimestampByLevel, levelKey, field, entry.snapshotTimestamp)
                    );
                    fieldConflictDeferrals[field] = marketMetadataFieldValue(
                        entry.snapshotConflictDeferredByLevel,
                        levelKey,
                        field,
                        false
                    ) === true;
                    revision = Math.max(revision, levelRevision);
                }
                for (const field of ["min", "max"]) {
                    if (!Object.prototype.hasOwnProperty.call(rawQuote, field)) continue;
                    const price = normalizeTradableMarketPrice(rawQuote[field]);
                    if (price !== null) quote[field] = price;
                }
                if (!Object.keys(quote).length) continue;
                const levelKey = String(level);
                levels[levelKey] = quote;
                revisionByLevel[levelKey] = fieldRevisions;
                receivedAtByLevel[levelKey] = fieldTimes;
                snapshotTimestampByLevel[levelKey] = fieldSnapshotTimestamps;
                snapshotConflictDeferredByLevel[levelKey] = fieldConflictDeferrals;
                levelCount += 1;
            }
            if (!Object.keys(levels).length) continue;
            const revisions = Object.values(revisionByLevel).flatMap(value => Object.values(value));
            const receivedTimes = Object.values(receivedAtByLevel).flatMap(value => Object.values(value));
            liveData[itemHrid] = {
                levels,
                revisionByLevel,
                receivedAtByLevel,
                snapshotTimestampByLevel,
                snapshotConflictDeferredByLevel,
                revision: revisions.length ? Math.max(...revisions) : Number(entry.revision) || 0,
                receivedAt: receivedTimes.length ? Math.max(...receivedTimes) : Number(entry.receivedAt) || 0
            };
            itemCount += 1;
        }
        const storedRevision = Number(stored.revision);
        if (Number.isSafeInteger(storedRevision) && storedRevision > 0) revision = Math.max(revision, storedRevision);
        return { liveData, revision, valid: true };
    }

    function serializeLiveMarketData(liveData, revision) {
        const restored = restoreLiveMarketData({
            schemaVersion: 3,
            revision: Number.isSafeInteger(Number(revision)) && Number(revision) > 0 ? Number(revision) : 0,
            items: liveData
        });
        return {
            schemaVersion: 3,
            revision: restored.revision,
            storedAt: Date.now(),
            items: restored.liveData
        };
    }

    function resolveMarketPriceFromState(snapshot, liveData, itemHrid, enhancementLevel, field) {
        const level = normalizeMarketLevel(enhancementLevel);
        if (!itemHrid || level === null || (field !== "a" && field !== "b")) return null;
        const liveQuote = liveData?.[itemHrid]?.levels?.[String(level)];
        const liveRange = liveData?.[itemHrid]?.levels?.[String(level)];
        if (liveQuote && Object.prototype.hasOwnProperty.call(liveQuote, field)) {
            const livePrice = Number(liveQuote[field]);
            if (!Number.isFinite(livePrice) || livePrice <= 0) return null;
            const minimum = normalizeTradableMarketPrice(liveRange?.min);
            return field === "b" && minimum !== null && livePrice < minimum ? null : livePrice;
        }
        const snapshotQuote = snapshot?.marketData?.[itemHrid]?.[String(level)];
        const snapshotPrice = Number(snapshotQuote?.[field]);
        if (!Number.isFinite(snapshotPrice) || snapshotPrice <= 0) return null;
        const minimum = normalizeTradableMarketPrice(liveRange?.min);
        return field === "b" && minimum !== null && snapshotPrice < minimum ? null : snapshotPrice;
    }

    function marketplaceSnapshotUrls() {
        const currentOrigin = String(PAGE_WINDOW.location?.origin || "").replace(/\/$/, "");
        const origins = [...new Set(MARKETPLACE_SNAPSHOT_ORIGINS.map(origin => String(origin).replace(/\/$/, "")).filter(Boolean))];
        if (!currentOrigin) return [MARKETPLACE_SNAPSHOT_PATH];
        if (!origins.includes(currentOrigin)) return [`${currentOrigin}${MARKETPLACE_SNAPSHOT_PATH}`];
        return [currentOrigin, ...origins.filter(origin => origin !== currentOrigin)]
            .map(origin => `${origin}${MARKETPLACE_SNAPSHOT_PATH}`);
    }

    function setMarketSnapshotState(snapshot, fetchedAt) {
        if (!snapshot) return;
        const marketData = sanitizeMarketData(snapshot.marketData);
        upgradeCostState.marketSnapshot = { timestamp: normalizeMarketTimestamp(snapshot.timestamp), marketData };
        upgradeCostState.marketSnapshotTimestamp = upgradeCostState.marketSnapshot.timestamp;
        upgradeCostState.marketSnapshotFetchedAt = Number(fetchedAt) || 0;
        const prices = Object.create(null);
        const quotes = Object.create(null);
        for (const [hrid, levels] of Object.entries(marketData)) {
            const info = levels?.["0"] || levels?.[0];
            if (!info) continue;
            const ask = Number(info.a);
            const bid = Number(info.b);
            quotes[hrid] = {
                a: Number.isFinite(ask) ? ask : -1,
                b: Number.isFinite(bid) ? bid : -1
            };
            prices[hrid] = ask > 0 ? ask : bid > 0 ? bid : -1;
        }
        upgradeCostState.marketQuotes = quotes;
        upgradeCostState.marketPrices = prices;
        upgradeCostState.marketFetchedAt = upgradeCostState.marketSnapshotFetchedAt;
    }

    function hydrateMarketState() {
        if (upgradeCostState.marketStateHydrated) return;
        upgradeCostState.marketStateHydrated = true;
        try {
            const rawLive = PAGE_WINDOW.localStorage?.getItem(MARKET_LIVE_STORAGE_KEY);
            const restored = restoreLiveMarketData(rawLive);
            if (restored.valid) {
                upgradeCostState.marketLiveData = restored.liveData;
                upgradeCostState.marketLiveRevision = restored.revision;
            }
        } catch (error) { /* Optional browser storage. */ }
        try {
            const rawSnapshot = PAGE_WINDOW.localStorage?.getItem(MARKET_SNAPSHOT_STORAGE_KEY);
            if (rawSnapshot) {
                const stored = JSON.parse(rawSnapshot);
                const timestamp = normalizeMarketTimestamp(stored?.timestamp);
                const marketData = sanitizeMarketData(stored?.marketData);
                const fetchedAt = Number(stored?.fetchedAt);
                if (stored?.schemaVersion === 1 && timestamp > 0 && Object.keys(marketData).length
                    && Number.isSafeInteger(fetchedAt) && fetchedAt > 0) {
                    setMarketSnapshotState({ timestamp, marketData }, fetchedAt);
                }
            }
        } catch (error) { /* Optional browser storage. */ }
        try {
            const rawRequest = PAGE_WINDOW.localStorage?.getItem(MARKET_REQUEST_STORAGE_KEY);
            const stored = rawRequest ? JSON.parse(rawRequest) : null;
            for (const origin of MARKETPLACE_SNAPSHOT_ORIGINS) {
                const until = Number(stored?.forbiddenUntilByOrigin?.[origin]);
                if (Number.isSafeInteger(until) && until > 0) {
                    upgradeCostState.marketSnapshotForbiddenUntilByOrigin[origin] = until;
                }
            }
        } catch (error) { /* Optional browser storage. */ }
    }

    function persistLiveMarketState() {
        if (guildCreditOwnsMarketData()) return;
        try {
            const storage = PAGE_WINDOW.localStorage;
            if (!storage) return;
            if (!Object.keys(upgradeCostState.marketLiveData || {}).length) {
                storage.removeItem(MARKET_LIVE_STORAGE_KEY);
                return;
            }
            storage.setItem(
                MARKET_LIVE_STORAGE_KEY,
                JSON.stringify(serializeLiveMarketData(upgradeCostState.marketLiveData, upgradeCostState.marketLiveRevision))
            );
        } catch (error) { /* Storage failures must not affect the game. */ }
    }

    function persistMarketSnapshotState() {
        if (guildCreditOwnsMarketData()) return;
        try {
            if (!upgradeCostState.marketSnapshot || !upgradeCostState.marketSnapshotTimestamp) return;
            PAGE_WINDOW.localStorage?.setItem(MARKET_SNAPSHOT_STORAGE_KEY, JSON.stringify({
                schemaVersion: 1,
                fetchedAt: upgradeCostState.marketSnapshotFetchedAt,
                timestamp: upgradeCostState.marketSnapshotTimestamp,
                marketData: upgradeCostState.marketSnapshot.marketData
            }));
        } catch (error) { /* Storage failures must not affect the game. */ }
    }

    function persistMarketRequestState() {
        if (guildCreditOwnsMarketData()) return;
        try {
            const forbiddenUntilByOrigin = Object.fromEntries(
                MARKETPLACE_SNAPSHOT_ORIGINS
                    .map(origin => [origin, Number(upgradeCostState.marketSnapshotForbiddenUntilByOrigin?.[origin])])
                    .filter(([, until]) => Number.isSafeInteger(until) && until > 0)
            );
            const storage = PAGE_WINDOW.localStorage;
            if (!storage) return;
            if (!Object.keys(forbiddenUntilByOrigin).length) storage.removeItem(MARKET_REQUEST_STORAGE_KEY);
            else storage.setItem(MARKET_REQUEST_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, forbiddenUntilByOrigin }));
        } catch (error) { /* Storage failures must not affect the game. */ }
    }

    function rememberLiveMarketUpdate(update, receivedAt) {
        if (!update) return false;
        let signature = "";
        try { signature = JSON.stringify(update.levels); } catch (error) { signature = ""; }
        const observedAt = Number(receivedAt);
        if ((!Number.isFinite(observedAt) || observedAt <= 0)
            && upgradeCostState.marketUpdateSignatures[update.itemHrid] === signature) return false;
        upgradeCostState.marketUpdateSignatures[update.itemHrid] = signature;
        upgradeCostState.marketLiveRevision = Math.min(Number.MAX_SAFE_INTEGER, upgradeCostState.marketLiveRevision + 1);
        const changed = applyLiveMarketUpdate(upgradeCostState.marketLiveData, update, {
            revision: upgradeCostState.marketLiveRevision,
            receivedAt: observedAt || Date.now(),
            snapshotTimestamp: upgradeCostState.marketSnapshotTimestamp
        });
        if (changed) {
            persistLiveMarketState();
            scheduleUpgradeCostRefresh();
        }
        return changed;
    }

    function scanMarketDom() {
        upgradeCostState.marketDomScanScheduled = false;
        if (guildCreditOwnsMarketData()) {
            upgradeCostState.marketDomObserver?.disconnect();
            upgradeCostState.marketDomObserver = null;
            return false;
        }
        const snapshot = readMarketDomSnapshot(document);
        if (!snapshot || snapshot.signature === upgradeCostState.lastMarketDomSignature) return false;
        const message = createMarketDomMessage(snapshot);
        if (!message) return false;
        upgradeCostState.lastMarketDomSignature = snapshot.signature;
        return rememberLiveMarketUpdate(normalizeMarketOrderBooksUpdate(message));
    }

    function scheduleMarketDomScan() {
        if (upgradeCostState.marketDomScanScheduled) return;
        upgradeCostState.marketDomScanScheduled = true;
        window.setTimeout(scanMarketDom, 40);
    }

    function startMarketDomObserver() {
        if (guildCreditOwnsMarketData()) return false;
        if (upgradeCostState.marketDomObserver || typeof MutationObserver !== "function") return false;
        const root = document.documentElement;
        if (!root) return false;
        upgradeCostState.marketDomObserver = new MutationObserver(scheduleMarketDomScan);
        upgradeCostState.marketDomObserver.observe(root, { subtree: true, childList: true, characterData: true });
        scheduleMarketDomScan();
        return true;
    }

    async function ensureUpgradeMarketPrices() {
        hydrateMarketState();
        const requestedAt = Date.now();
        if (upgradeCostState.marketSnapshot && requestedAt >= upgradeCostState.marketSnapshotFetchedAt
            && requestedAt - upgradeCostState.marketSnapshotFetchedAt < MARKETPLACE_SNAPSHOT_MAX_AGE_MS) return true;
        if (upgradeCostState.marketPromise) return upgradeCostState.marketPromise;
        upgradeCostState.marketPromise = (async () => {
            try {
                const fetchImpl = typeof PAGE_WINDOW.fetch === "function" ? PAGE_WINDOW.fetch.bind(PAGE_WINDOW) : fetch;
                const failures = [];
                let rawSnapshot = null;
                let marketData = null;
                let nextTimestamp = 0;
                const liveRevisionAtRequestStart = upgradeCostState.marketLiveRevision;
                for (const url of marketplaceSnapshotUrls()) {
                    let origin = "";
                    try { origin = new URL(url, PAGE_WINDOW.location?.href).origin; } catch (error) { /* Ignore invalid URL. */ }
                    const forbiddenUntil = Number(upgradeCostState.marketSnapshotForbiddenUntilByOrigin?.[origin]);
                    if (Number.isSafeInteger(forbiddenUntil) && forbiddenUntil > requestedAt) {
                        failures.push(`${origin || url}: HTTP 403 backoff`);
                        continue;
                    }
                    try {
                        const response = await fetchImpl(url, { cache: "default" });
                        if (!response || !response.ok) {
                            if (response?.status === 403 && origin) {
                                upgradeCostState.marketSnapshotForbiddenUntilByOrigin[origin] = requestedAt + MARKETPLACE_SNAPSHOT_FORBIDDEN_BACKOFF_MS;
                                persistMarketRequestState();
                            }
                            throw new Error(`HTTP ${response ? response.status : "unknown"}`);
                        }
                        if (origin) {
                            delete upgradeCostState.marketSnapshotForbiddenUntilByOrigin[origin];
                            persistMarketRequestState();
                        }
                        rawSnapshot = await response.json();
                        marketData = sanitizeMarketData(rawSnapshot?.marketData || rawSnapshot);
                        nextTimestamp = normalizeMarketTimestamp(rawSnapshot?.timestamp);
                        if (!Object.keys(marketData).length) throw new Error("Marketplace payload is empty.");
                        if (nextTimestamp <= 0) throw new Error("Marketplace payload has no valid timestamp.");
                        break;
                    } catch (error) {
                        failures.push(`${origin || url}: ${String(error?.message || error)}`);
                        rawSnapshot = null;
                        marketData = null;
                        nextTimestamp = 0;
                    }
                }
                if (!rawSnapshot || !marketData || nextTimestamp <= 0) {
                    upgradeCostState.marketError = true;
                    return Boolean(upgradeCostState.marketSnapshot);
                }
                if (upgradeCostState.marketSnapshotTimestamp > 0 && nextTimestamp < upgradeCostState.marketSnapshotTimestamp) {
                    return Boolean(upgradeCostState.marketSnapshot);
                }
                const missingCount = countMissingMarketEntries(upgradeCostState.marketSnapshot?.marketData, marketData);
                const candidateSignature = JSON.stringify(createMarketStructure(marketData));
                if (missingCount > 0 && nextTimestamp === upgradeCostState.marketSnapshotTimestamp) {
                    upgradeCostState.marketSnapshotCandidateSignature = "";
                    upgradeCostState.marketSnapshotCandidateTimestamp = 0;
                    upgradeCostState.marketSnapshotCandidateConfirmations = 0;
                    return Boolean(upgradeCostState.marketSnapshot);
                }
                if (missingCount > 0) {
                    const matches = upgradeCostState.marketSnapshotCandidateSignature === candidateSignature
                        && nextTimestamp >= upgradeCostState.marketSnapshotCandidateTimestamp;
                    upgradeCostState.marketSnapshotCandidateSignature = candidateSignature;
                    upgradeCostState.marketSnapshotCandidateTimestamp = nextTimestamp;
                    upgradeCostState.marketSnapshotCandidateConfirmations = matches
                        ? Math.min(2, upgradeCostState.marketSnapshotCandidateConfirmations + 1)
                        : 1;
                    if (upgradeCostState.marketSnapshotCandidateConfirmations < 2) return Boolean(upgradeCostState.marketSnapshot);
                }
                const reconciliation = reconcileLiveMarketData(upgradeCostState.marketLiveData, {
                    previousSnapshotTimestamp: upgradeCostState.marketSnapshotTimestamp,
                    nextSnapshotTimestamp: nextTimestamp,
                    coveredRevision: liveRevisionAtRequestStart,
                    snapshotData: marketData
                });
                if (reconciliation.changed) {
                    upgradeCostState.marketUpdateSignatures = Object.create(null);
                    persistLiveMarketState();
                }
                setMarketSnapshotState({ ...rawSnapshot, timestamp: nextTimestamp, marketData }, requestedAt);
                persistMarketSnapshotState();
                upgradeCostState.marketSnapshotCandidateSignature = "";
                upgradeCostState.marketSnapshotCandidateTimestamp = 0;
                upgradeCostState.marketSnapshotCandidateConfirmations = 0;
                upgradeCostState.marketError = false;
                return true;
            } catch (error) {
                upgradeCostState.marketError = true;
                return Boolean(upgradeCostState.marketSnapshot);
            } finally {
                upgradeCostState.marketPromise = null;
            }
        })();
        return upgradeCostState.marketPromise;
    }

    function marketPrice(itemHrid) {
        return Number(upgradeCostState.marketPrices?.[itemHrid]) > 0 ? Number(upgradeCostState.marketPrices[itemHrid]) : -1;
    }

    function nativeMarketPrice(itemHrid) {
        const field = nativePriceReference();
        const price = resolveMarketPriceFromState(
            upgradeCostState.marketSnapshot,
            upgradeCostState.marketLiveData,
            itemHrid,
            0,
            field
        );
        return price === null ? -1 : price;
    }

    function conversionEntries(creditHrid) {
        return itemDetailEntries().flatMap(([itemKey, detail]) => {
            const itemHrid = detail?.itemHrid || detail?.hrid || itemKey;
            return (Array.isArray(detail?.guildCreditConversions) ? detail.guildCreditConversions : [])
                .filter(conversion => conversion?.creditItemHrid === creditHrid)
                .map(conversion => ({
                    itemHrid,
                    itemName: itemName(itemHrid, detail?.name),
                    creditItemHrid: conversion.creditItemHrid,
                    itemCount: Number(conversion.itemCount),
                    creditCount: Number(conversion.creditCount)
                }))
                .filter(conversion => conversion.itemHrid && conversion.itemCount > 0 && conversion.creditCount > 0);
        });
    }

    function conversionOrderBook(itemHrid, priceResolver = marketPrice) {
        const price = priceResolver(itemHrid);
        return price > 0 ? { asks: [{ price, quantity: Number.MAX_SAFE_INTEGER }] } : null;
    }

    function quoteConversion(orderBook, requestedQuantity) {
        const quantity = Math.ceil(Number(requestedQuantity));
        if (!Number.isSafeInteger(quantity) || quantity <= 0) return { status: "invalid_quantity", requestedQuantity, availableQuantity: 0, cost: null, fills: [] };
        const asks = Array.isArray(orderBook?.asks) ? orderBook.asks.map(ask => ({ price: Number(ask?.price), quantity: Number(ask?.quantity) })).filter(ask => Number.isFinite(ask.price) && ask.price >= 0 && Number.isSafeInteger(ask.quantity) && ask.quantity > 0).sort((a,b) => a.price-b.price) : [];
        let remaining = quantity, cost = 0, availableQuantity = 0;
        const fills = [];
        for (const ask of asks) {
            availableQuantity += ask.quantity;
            if (!remaining) continue;
            const take = Math.min(remaining, ask.quantity);
            cost += take * ask.price;
            fills.push({ price: ask.price, quantity: take });
            remaining -= take;
        }
        return remaining > 0 ? { status: "insufficient_depth", requestedQuantity: quantity, availableQuantity, cost: null, fills } : { status: "ok", requestedQuantity: quantity, availableQuantity, cost, fills };
    }

    function evaluateConversion(conversion, targetCredits, priceResolver = marketPrice) {
        const target = Math.ceil(Number(targetCredits));
        const itemCount = Number(conversion?.itemCount);
        const creditCount = Number(conversion?.creditCount);
        if (!Number.isSafeInteger(target) || target <= 0 || !Number.isSafeInteger(itemCount) || itemCount <= 0 || !Number.isSafeInteger(creditCount) || creditCount <= 0) {
            return { status: "invalid_conversion", conversion };
        }
        const batches = Math.ceil(target / creditCount);
        const requiredItems = batches * itemCount;
        const actualCredits = batches * creditCount;
        const quote = quoteConversion(conversionOrderBook(conversion.itemHrid, priceResolver), requiredItems);
        return {
            status: quote.status,
            itemHrid: conversion.itemHrid,
            itemName: conversion.itemName,
            creditItemHrid: conversion.creditItemHrid,
            itemCount,
            creditCount,
            targetCredits: target,
            batches,
            requiredItems,
            actualCredits,
            fills: quote.fills,
            cost: quote.status === "ok" ? quote.cost : null,
            costPerCredit: quote.status === "ok" ? quote.cost / actualCredits : null
        };
    }

    function bestCreditConversion(creditHrid, targetCredits, priceResolver = marketPrice) {
        if (NATIVE_CREDIT_GUILD_TOKEN_OVERRIDES.has(creditHrid)) return null;
        const ranked = conversionEntries(creditHrid)
            .map(conversion => evaluateConversion(conversion, targetCredits, priceResolver))
            .sort((left, right) => {
                if (left.status === "ok" && right.status !== "ok") return -1;
                if (right.status === "ok" && left.status !== "ok") return 1;
                if (left.status !== "ok" || right.status !== "ok") return String(left.itemName).localeCompare(String(right.itemName), "zh-CN");
                return left.costPerCredit - right.costPerCredit || left.cost - right.cost || left.itemName.localeCompare(right.itemName, "zh-CN");
            });
        return ranked.find(row => row.status === "ok") || null;
    }

    function purchaseCreditConversion(creditHrid, targetCredits, priceResolver = marketPrice) {
        const preferredItemHrid = NATIVE_CREDIT_PURCHASE_ITEM_OVERRIDES[creditHrid];
        if (!preferredItemHrid) return bestCreditConversion(creditHrid, targetCredits, priceResolver);
        const preferred = conversionEntries(creditHrid).find(conversion => conversion.itemHrid === preferredItemHrid);
        return preferred ? evaluateConversion(preferred, targetCredits, priceResolver) : null;
    }

    function renderUpgradeCostRows(rows, className) {
        const goldCost = (row, field, fallbackField) => {
            const direct = Number(row?.[field]);
            if (Number.isFinite(direct) && direct >= 0) return direct;
            const unitPrice = Number(row?.unitPrice);
            const quantity = Number(row?.[fallbackField]);
            return Number.isFinite(unitPrice) && unitPrice > 0 && Number.isFinite(quantity) ? unitPrice * quantity : 0;
        };
        const tokenCost = (row, field, fallbackField) => {
            const direct = Number(row?.[field]);
            if (Number.isFinite(direct) && direct >= 0) return direct;
            return row?.itemHrid === "/items/guild_token" ? Math.max(0, Number(row?.[fallbackField]) || 0) : 0;
        };
        const totalGold = rows.reduce((sum, row) => sum + goldCost(row, "fullCost", "required"), 0);
        const tokenCount = rows.reduce((sum, row) => sum + tokenCost(row, "fullTokens", "required"), 0);
        const missingGold = rows.reduce((sum, row) => sum + goldCost(row, "missingCost", "missing"), 0);
        const missingTokens = rows.reduce((sum, row) => sum + tokenCost(row, "missingTokens", "missing"), 0);
        const unpriced = rows.filter(row => row.unpriced || (row.unitPrice <= 0 && row.itemHrid !== "/items/guild_token" && row.fullTokens <= 0)).length;
        const fullTotal = `${compactNumber(totalGold)} 金币${tokenCount > 0 ? ` + ${formatNumber(tokenCount)} 公会代币` : ""}`;
        const missingTotal = `${compactNumber(missingGold)} 金币${missingTokens > 0 ? ` + ${formatNumber(missingTokens)} 公会代币` : ""}`;
        const rowHtml = rows.map(row => {
            const fullCost = goldCost(row, "fullCost", "required");
            const lineTotal = row.fullTokens > 0
                ? `${formatNumber(row.fullTokens)} 公会代币`
                : row.itemHrid === "/items/guild_token"
                    ? "公会代币"
                    : row.unpriced || row.unitPrice <= 0
                        ? "暂无价格"
                        : `${compactNumber(fullCost)} 金币`;
            const unitText = row.fullTokens > 0
                ? "按公会代币兑换"
                : row.itemHrid === "/items/guild_token"
                    ? "升级材料"
                    : row.unitPrice > 0
                        ? `${compactNumber(row.unitPrice)} 金币/个`
                        : "未估价";
            const exchangeText = row.exchangeItemName
                ? ` · 兑换 ${escapeHtml(row.exchangeItemName)} × ${formatNumber(row.fullPurchaseQuantity || 0)}`
                : "";
            return `<div class="mwi-upgrade-cost-row"><span>${escapeHtml(row.name)}</span><small>${formatNumber(row.required)} 个 · ${unitText}${exchangeText}</small><b>${lineTotal}</b></div>`;
        }).join("");
        return `<section class="${className}"><div class="mwi-listing-upgrade-cost-title">升级成本</div><div class="mwi-upgrade-cost-total"><span>材料完整成本</span><strong>${fullTotal}${unpriced ? ` · ${unpriced} 项未估价` : ""}</strong></div><div class="mwi-upgrade-cost-total"><span>扣除库存后还需</span><strong>${missingTotal}</strong></div><div class="mwi-upgrade-cost-detail-title">每种材料</div>${rowHtml}</section>`;
    }

    function housePanel() {
        return [...document.querySelectorAll('[class*="HousePanel_modalContent"]')].find(node => visible(node) && node.querySelector('[class*="HousePanel_itemRequirements"]')) || null;
    }

    function parseHouseRequirements(panel) {
        const requirements = panel.querySelector('[class*="HousePanel_itemRequirements"]');
        if (!requirements) return [];
        const wrappers = [...requirements.querySelectorAll(':scope > [class*="Item_itemContainer"]')];
        const inventories = [...requirements.querySelectorAll(':scope > [class*="HousePanel_inventoryCount"]')];
        const inputs = [...requirements.querySelectorAll(':scope > [class*="HousePanel_inputCount"]')];
        const rows = wrappers.map((wrapper, index) => {
            const itemHrid = itemHridFromNode(wrapper);
            const text = String(inputs[index]?.textContent || "");
            const inventoryText = String(inventories[index]?.textContent || "");
            const needMatch = text.match(/\/\s*([\d.,]+\s*[KMB]?)/i) || text.match(/([\d.,]+\s*[KMB]?)/i);
            const stock = parseCompactNumber(inventoryText) ?? 0;
            const required = Math.max(0, Math.ceil(parseCompactNumber(needMatch?.[1]) || 0));
            return { itemHrid, name: itemName(itemHrid, wrapper.textContent), required, missing: Math.max(0, required - stock) };
        }).filter(row => row.required > 0);
        const costs = panel.querySelector('[class*="HousePanel_costs"]');
        const costText = String(costs?.textContent || "");
        const number = String.raw`\d[\d.,]*\s*[KMB]?`;
        const coinMatch = costText.match(new RegExp(String.raw`(${number})\s*[\/／]\s*(${number})[^\/\d]{0,40}(?:金币|coin|gold)`, "i"))
            || costText.match(new RegExp(String.raw`(?:金币|coin|gold)[^\/\d]{0,50}(${number})\s*[\/／]\s*(${number})`, "i"))
            || costText.match(new RegExp(String.raw`(${number})\s*[\/／]\s*(${number})`, "i"));
        if (coinMatch) {
            const required = Math.max(0, Math.ceil(parseCompactNumber(coinMatch[2]) || 0));
            const stock = Math.max(0, Math.floor(parseCompactNumber(coinMatch[1]) || 0));
            const coinRow = { itemHrid: "/items/coin", name: "金币", required, missing: Math.max(0, required - stock) };
            const coinIndex = rows.findIndex(row => row.itemHrid === "/items/coin" || /金币|coin|gold/i.test(row.name));
            if (coinIndex >= 0) rows[coinIndex] = coinRow;
            else rows.unshift(coinRow);
        }
        return rows;
    }

    function nativeUpgradeLevels(levelElement) {
        const levels = String(levelElement && levelElement.textContent || "").match(/\d+/g) || [];
        if (levels.length < 2) return null;
        const startLevel = Number(levels[0]);
        const targetLevel = Number(levels[1]);
        return Number.isSafeInteger(startLevel) && Number.isSafeInteger(targetLevel) && targetLevel > startLevel
            ? { startLevel, targetLevel }
            : null;
    }

    function shrineName(entry) {
        const shrine = String(entry?.detail?.shrineHrid || entry?.hrid || "");
        const key = SHRINE_NAME_KEYS[shrine];
        if (key) return nativeText(key);
        return shrine.split("/").pop().replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function shrineLabel(entry) {
        const domain = entry?.detail?.isCombat === true
            ? nativeText("domainCombat")
            : entry?.detail?.isCombat === false
                ? nativeText("domainLife")
                : "";
        const name = shrineName(entry);
        return domain ? nativeText("shrineWithDomain", { shrine: name, domain }) : name;
    }

    function guildBuffEntries() {
        syncUpgradeDataFromPage();
        const source = upgradeCostState.guildBuffDetails;
        const details = Array.isArray(source)
            ? source.map(detail => [detail?.hrid || detail?.guildBuffHrid, detail])
            : Object.entries(source || {});
        return details
            .map(([hrid, rawDetail]) => {
                const detail = rawDetail?.detail || rawDetail?.guildBuffDetail || rawDetail;
                return { hrid: detail?.hrid || detail?.guildBuffHrid || hrid, detail };
            })
            .filter(entry => entry.hrid && entry.detail?.levelCosts)
            .map(entry => ({
                ...entry,
                maxLevel: Array.isArray(entry.detail.levelCosts)
                    ? entry.detail.levelCosts.length - 1
                    : Math.max(...Object.keys(entry.detail.levelCosts).map(Number).filter(Number.isSafeInteger))
            }))
            .filter(entry => Number.isSafeInteger(entry.maxLevel) && entry.maxLevel > 0)
            .sort((left, right) => shrineLabel(left).localeCompare(shrineLabel(right), nativeLocale()));
    }

    function shrineEntries() {
        return guildBuffEntries();
    }

    function findNativeGuildBuffModal() {
        syncUpgradeDataFromPage();
        const entries = guildBuffEntries();
        if (!entries.length) return null;
        const candidates = [...document.querySelectorAll('[class*="GuildPanel_guildModalContent"]')].filter(visible);
        for (const content of candidates) {
            const header = content.querySelector('[class*="GuildPanel_header"]');
            const domain = content.querySelector('[class*="GuildPanel_domainLabel"]');
            const level = content.querySelector('[class*="GuildPanel_level"]');
            const costs = content.querySelector('[class*="GuildPanel_costs"]');
            const requirements = content.querySelector('[class*="GuildPanel_itemRequirements"]');
            const levels = nativeUpgradeLevels(level);
            if (!header || !domain || !costs || !requirements || !levels) continue;
            const headerText = String(header.textContent || "").trim();
            const domainText = String(domain.textContent || "").trim();
            const entry = entries.find(candidate => {
                const expectedDomain = candidate.detail?.isCombat === true
                    ? nativeText("domainCombat")
                    : nativeText("domainLife");
                return headerText.includes(shrineName(candidate)) && domainText.includes(expectedDomain);
            });
            if (!entry || levels.targetLevel > entry.maxLevel) continue;
            return {
                content,
                panel: content,
                modal: content.closest('[class*="Modal_modal"]') || content,
                costs,
                entry,
                startLevel: levels.startLevel,
                targetLevel: levels.targetLevel
            };
        }
        return null;
    }

    function shrinePanel() {
        return findNativeGuildBuffModal();
    }

    function aggregateGuildBuffLevelCosts(levelCosts, startLevel, targetLevel) {
        const start = Number(startLevel);
        const target = Number(targetLevel);
        const costs = Array.isArray(levelCosts)
            ? levelCosts
            : levelCosts && typeof levelCosts === "object"
                ? levelCosts
                : null;
        if (!costs || !Number.isSafeInteger(start) || !Number.isSafeInteger(target) || start < 0 || target <= start) {
            return { status: "invalid_range", startLevel, targetLevel, totals: [] };
        }

        const maxLevel = Array.isArray(costs)
            ? costs.length - 1
            : Math.max(...Object.keys(costs).map(Number).filter(Number.isSafeInteger));
        if (!Number.isSafeInteger(maxLevel) || target > maxLevel) {
            return { status: "invalid_range", startLevel: start, targetLevel: target, maxLevel, totals: [] };
        }

        const totals = new Map();
        const add = (itemHrid, count) => {
            const quantity = Number(count);
            if (!itemHrid || !Number.isFinite(quantity) || quantity <= 0) return;
            totals.set(itemHrid, (totals.get(itemHrid) || 0) + quantity);
        };

        for (let level = start + 1; level <= target; level += 1) {
            const cost = costs[level] ?? costs[String(level)];
            if (!cost || typeof cost !== "object") {
                return {
                    status: "missing_cost",
                    startLevel: start,
                    targetLevel: target,
                    maxLevel,
                    missingLevel: level,
                    totals: []
                };
            }
            add("/items/guild_token", cost.guildTokenCost);
            for (const creditCost of Array.isArray(cost.creditCosts) ? cost.creditCosts : []) {
                add(creditCost?.itemHrid, creditCost?.count);
            }
        }

        return {
            status: "ok",
            startLevel: start,
            targetLevel: target,
            maxLevel,
            totals: [...totals.entries()]
                .map(([itemHrid, count]) => ({ itemHrid, count }))
                .sort((left, right) => left.itemHrid.localeCompare(right.itemHrid))
        };
    }

    function inventoryCounts() {
        syncUpgradeDataFromPage();
        const counts = Object.create(null);
        for (const item of upgradeCostState.characterItems || []) {
            if (!item || item.itemLocationHrid !== "/item_locations/inventory") continue;
            const count = Number(item.count);
            if (!item.itemHrid || !Number.isFinite(count) || count <= 0) continue;
            counts[item.itemHrid] = (counts[item.itemHrid] || 0) + count;
        }
        return counts;
    }

    function nativeBestCreditConversions(targetCreditsByHrid) {
        return Object.fromEntries([...CREDIT_HRIDS].map(creditItemHrid => {
            const targetCredits = targetCreditsByHrid
                ? Number(targetCreditsByHrid[creditItemHrid])
                : 1;
            if (!Number.isSafeInteger(targetCredits) || targetCredits <= 0) return [creditItemHrid, null];
            return [creditItemHrid, bestCreditConversion(creditItemHrid, targetCredits, nativeMarketPrice)];
        }));
    }

    function nativeBestCreditUnitCosts() {
        const tokenCreditTargets = Object.fromEntries(
            GUILD_TOKEN_CREDIT_CONVERSIONS.map(rule => [rule.creditItemHrid, rule.creditCount])
        );
        return Object.fromEntries(
            Object.entries(nativeBestCreditConversions(tokenCreditTargets)).map(([creditItemHrid, best]) => [
                creditItemHrid,
                best ? best.costPerCredit : null
            ])
        );
    }

    function estimateGuildUpgradeCosts(totals, creditUnitCosts, inventory) {
        const unitCosts = creditUnitCosts && typeof creditUnitCosts === "object" ? creditUnitCosts : {};
        const inventoryCountsByHrid = inventory && typeof inventory === "object" ? inventory : {};
        const rows = [];
        const unpricedItemHrids = [];
        let totalGold = 0;
        let missingGold = 0;
        let guildTokensRequired = 0;
        let guildTokenRow = null;
        const guildTokensOwned = Math.max(0, Number(inventoryCountsByHrid["/items/guild_token"]) || 0);

        for (const item of Array.isArray(totals) ? totals : []) {
            const itemHrid = item?.itemHrid;
            const required = Number(item?.count);
            if (!itemHrid || !Number.isFinite(required) || required <= 0) continue;
            const owned = Math.max(0, Number(inventoryCountsByHrid[itemHrid]) || 0);
            const missing = Math.max(0, required - owned);
            if (itemHrid === "/items/guild_token") {
                guildTokensRequired += required;
                guildTokenRow = {
                    itemHrid,
                    required,
                    owned,
                    missing,
                    unitCost: null,
                    totalCost: null,
                    missingCost: null
                };
                rows.push(guildTokenRow);
                continue;
            }

            const unitCost = Number(unitCosts[itemHrid]);
            const priced = Number.isFinite(unitCost) && unitCost > 0;
            if (priced) {
                totalGold += required * unitCost;
                missingGold += missing * unitCost;
            } else {
                unpricedItemHrids.push(itemHrid);
            }
            rows.push({
                itemHrid,
                required,
                owned,
                missing,
                unitCost: priced ? unitCost : null,
                totalCost: priced ? required * unitCost : null,
                missingCost: priced ? missing * unitCost : null
            });
        }

        const guildTokensMissing = Math.max(0, guildTokensRequired - guildTokensOwned);
        if (guildTokenRow) {
            guildTokenRow.shrineRequired = guildTokensRequired;
        }
        return {
            status: unpricedItemHrids.length ? "partial" : "ok",
            totalGold,
            missingGold,
            guildTokensRequired,
            guildTokensOwned,
            guildTokensMissing,
            guildTokenCreditExchangeRequired: 0,
            manualGuildTokenCreditExchangeRequired: 0,
            autoGuildTokenCreditExchangeUsed: 0,
            autoGuildTokenBudgetAvailable: 0,
            autoGuildTokenBudget: 0,
            autoGuildTokenAllocations: [],
            useGuildTokensForMissingCredits: false,
            guildTokenCreditHrids: [],
            unpricedItemHrids,
            rows
        };
    }

    function nativeItemSpriteHref(itemHrid) {
        const spriteUse = [...document.querySelectorAll("use")].find(use => {
            const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
            return href.includes("items_sprite");
        });
        const href = spriteUse?.getAttribute("href") || spriteUse?.getAttribute("xlink:href") || "";
        if (!href || !href.includes("#")) return "";
        return `${href.slice(0, href.indexOf("#"))}#${String(itemHrid || "").split("/").pop()}`;
    }

    function nativeIconMarkup(itemHrid, label) {
        const href = nativeItemSpriteHref(itemHrid);
        if (!href) return '<span class="mwi-item-icon mwi-item-icon-fallback" aria-hidden="true"></span>';
        return `<svg class="mwi-item-icon" role="img" aria-label="${escapeHtml(label)}"><use href="${escapeHtml(href)}"></use></svg>`;
    }

    function nativeFormatCompactCost(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "-";
        if (Math.abs(amount) >= 1e9) return `${nativeFormatNumber(amount / 1e9, 2)}B`;
        if (Math.abs(amount) >= 1e6) return `${nativeFormatNumber(amount / 1e6, 2)}M`;
        if (Math.abs(amount) >= 1e3) return `${nativeFormatNumber(amount / 1e3, 2)}K`;
        return nativeFormatNumber(amount, 0);
    }

    function nativeFormatCoreCompactCost(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "-";
        const rounded = Math.round(amount);
        if (rounded < 10000) return String(rounded);
        const thousands = Math.round(rounded / 1000);
        if (thousands < 10000) return `${thousands}k`;
        return `${Math.round(rounded / 1000000)}m`;
    }

    function nativeUpgradeCostValue(gold, guildTokens) {
        const parts = [`${nativeFormatCompactCost(gold)} ${nativeText("gold")}`];
        if (guildTokens > 0) parts.push(`${nativeFormatNumber(guildTokens)} ${nativeText("guildTokens")}`);
        return parts.join(" + ");
    }

    function nativeCreditPurchasePlans(estimate, quantityField) {
        const field = quantityField === "required" ? "required" : "missing";
        const targetCredits = Object.fromEntries((estimate?.rows || [])
            .filter(row => CREDIT_HRIDS.has(row.itemHrid))
            .filter(row => !NATIVE_CREDIT_GUILD_TOKEN_OVERRIDES.has(row.itemHrid))
            .map(row => {
                const quantity = field === "required" ? row.required : row.remainingMissing ?? row.missing;
                return [row.itemHrid, Math.max(0, Math.floor(Number(quantity) || 0))];
            }));
        const plans = nativeBestCreditConversions(targetCredits);
        for (const [creditItemHrid, itemHrid] of Object.entries(NATIVE_CREDIT_PURCHASE_ITEM_OVERRIDES)) {
            const target = Number(targetCredits[creditItemHrid]);
            if (!Number.isSafeInteger(target) || target <= 0) continue;
            const conversion = conversionEntries(creditItemHrid).find(candidate => candidate.itemHrid === itemHrid);
            if (!conversion) {
                plans[creditItemHrid] = null;
                continue;
            }
            const ranked = purchaseCreditConversion(creditItemHrid, target, nativeMarketPrice);
            plans[creditItemHrid] = ranked?.status === "ok" ? ranked : null;
        }
        return plans;
    }

    function nativeGuildTokenCreditExchange(row, quantityField) {
        if (!row || !NATIVE_CREDIT_GUILD_TOKEN_OVERRIDES.has(row.itemHrid)) return null;
        const rule = GUILD_TOKEN_CREDIT_CONVERSIONS.find(candidate => candidate.creditItemHrid === row.itemHrid);
        if (!rule) return null;
        const quantity = quantityField === "required" ? row.required : row.remainingMissing ?? row.missing;
        const credits = Math.max(0, Math.floor(Number(quantity) || 0));
        if (credits <= 0) return null;
        const batches = Math.ceil(credits / rule.creditCount);
        return {
            ...rule,
            batches,
            actualCredits: batches * rule.creditCount,
            requiredGuildTokens: batches * rule.guildTokenCount
        };
    }

    function nativeGuildTokenCreditExchangeTotal(estimate, quantityField) {
        return (estimate?.rows || []).reduce((total, row) => {
            const exchange = nativeGuildTokenCreditExchange(row, quantityField);
            return total + (exchange ? exchange.requiredGuildTokens : 0);
        }, 0);
    }

    function nativePurchasePlanGold(plans) {
        return Object.values(plans || {}).reduce((total, plan) => {
            const cost = Number(plan?.cost);
            return Number.isFinite(cost) && cost > 0 ? total + cost : total;
        }, 0);
    }

    function withNativePurchasePlanCosts(estimate, fullPurchasePlans, missingPurchasePlans) {
        if (!estimate) return estimate;
        const baseGuildTokenRow = (estimate.rows || []).find(row => row.itemHrid === "/items/guild_token");
        const baseGuildTokensRequired = Math.max(0, Math.floor(Number(baseGuildTokenRow?.required) || 0));
        const baseGuildTokensMissing = Math.max(0, Math.floor(Number(baseGuildTokenRow?.missing) || 0));
        return {
            ...estimate,
            totalGold: nativePurchasePlanGold(fullPurchasePlans),
            missingGold: nativePurchasePlanGold(missingPurchasePlans),
            guildTokensRequired: baseGuildTokensRequired + nativeGuildTokenCreditExchangeTotal(estimate, "required"),
            guildTokensMissing: baseGuildTokensMissing + nativeGuildTokenCreditExchangeTotal(estimate, "missing")
        };
    }

    function renderNativeCreditPurchasePlans(estimate, purchasePlans) {
        const creditRows = (estimate?.rows || [])
            .filter(row => CREDIT_HRIDS.has(row.itemHrid))
            .filter(row => Math.max(0, Number(row.remainingMissing ?? row.missing) || 0) > 0);
        if (!creditRows.length) {
            return `<div class="mwi-native-cost-detail-empty">${escapeHtml(nativeText("nativeUpgradeNoCreditPurchase"))}</div>`;
        }
        const rows = creditRows.map(row => {
            const creditName = itemName(row.itemHrid);
            const tokenExchange = nativeGuildTokenCreditExchange(row, "missing");
            if (tokenExchange) {
                const guildTokenName = itemName("/items/guild_token");
                return `<div class="mwi-native-cost-detail-row"><span>${nativeIconMarkup(row.itemHrid, creditName)}<b>${escapeHtml(creditName)}</b></span><span>${nativeIconMarkup("/items/guild_token", guildTokenName)}<b>${escapeHtml(guildTokenName)}</b></span><small>${escapeHtml(nativeText("nativeUpgradeTokenExchangeQuantity", { count: nativeFormatNumber(tokenExchange.actualCredits) }))}</small><small>${escapeHtml(nativeText("exchangeRate", { items: `${nativeFormatNumber(tokenExchange.guildTokenCount)} ${nativeText("guildTokens")}`, credits: nativeCreditQuantity(tokenExchange.creditCount) }))}</small><strong>${escapeHtml(nativeText("nativeUpgradeTokenExchangeCost", { count: nativeFormatNumber(tokenExchange.requiredGuildTokens) }))}</strong></div>`;
            }
            const plan = purchasePlans?.[row.itemHrid];
            if (!plan) {
                return `<div class="mwi-native-cost-detail-row mwi-native-cost-detail-unpriced"><span>${nativeIconMarkup(row.itemHrid, creditName)}<b>${escapeHtml(creditName)}</b></span><em>${escapeHtml(nativeText("nativeUpgradeCreditUnpriced"))}</em></div>`;
            }
            const purchaseName = itemName(plan.itemHrid, plan.itemName);
            const averageUnitPrice = plan.requiredItems > 0 ? plan.cost / plan.requiredItems : null;
            return `<div class="mwi-native-cost-detail-row"><span>${nativeIconMarkup(row.itemHrid, creditName)}<b>${escapeHtml(creditName)}</b></span><span>${nativeIconMarkup(plan.itemHrid, purchaseName)}<b>${escapeHtml(purchaseName)}</b></span><small>${escapeHtml(nativeText("nativeUpgradePurchaseQuantity", { count: nativeFormatNumber(plan.requiredItems) }))}</small><small>${escapeHtml(nativeText("nativeUpgradeUnitPrice", { price: averageUnitPrice === null ? "-" : nativeFormatNumber(averageUnitPrice, 2) }))}</small><strong>${escapeHtml(nativeText("nativeUpgradeLineTotal", { total: `${nativeFormatCoreCompactCost(plan.cost)} ${nativeText("gold")}` }))}</strong></div>`;
        }).join("");
        return `<div class="mwi-native-cost-details"><div class="mwi-native-cost-detail-title">${escapeHtml(nativeText("nativeUpgradePurchasePlan"))}</div>${rows}</div>`;
    }

    function calculatePureGuildTokenPlan(estimate) {
        const rows = Array.isArray(estimate?.rows) ? estimate.rows : [];
        const baseGuildTokenRow = rows.find(row => row.itemHrid === "/items/guild_token");
        const baseTokensRequired = Math.max(0, Math.floor(Number(baseGuildTokenRow?.required) || 0));
        const baseTokensOwned = Math.max(0, Math.floor(Number(baseGuildTokenRow?.owned) || 0));
        const baseTokensMissing = Math.max(0, baseTokensRequired - baseTokensOwned);

        const creditRows = [];
        let totalCreditTokensRequired = 0;
        let totalCreditTokensMissing = 0;

        for (const row of rows) {
            if (!row?.itemHrid || !CREDIT_HRIDS.has(row.itemHrid)) continue;
            const rule = GUILD_TOKEN_CREDIT_CONVERSIONS.find(candidate => candidate.creditItemHrid === row.itemHrid);
            if (!rule) continue;

            const requiredCredits = Math.max(0, Math.floor(Number(row.required) || 0));
            const ownedCredits = Math.max(0, Math.floor(Number(row.owned) || 0));
            const missingCredits = Math.max(0, Math.floor(Number(row.remainingMissing ?? row.missing) || 0));

            const fullBatches = requiredCredits > 0 ? Math.ceil(requiredCredits / rule.creditCount) : 0;
            const fullTokens = fullBatches * rule.guildTokenCount;

            const missingBatches = missingCredits > 0 ? Math.ceil(missingCredits / rule.creditCount) : 0;
            const missingTokens = missingBatches * rule.guildTokenCount;

            totalCreditTokensRequired += fullTokens;
            totalCreditTokensMissing += missingTokens;

            creditRows.push({
                itemHrid: row.itemHrid,
                requiredCredits,
                ownedCredits,
                missingCredits,
                rule,
                fullBatches,
                fullTokens,
                missingBatches,
                missingTokens
            });
        }

        const pureTokensFullTotal = baseTokensRequired + totalCreditTokensRequired;
        const pureTokensMissingTotal = Math.max(0, baseTokensRequired + totalCreditTokensMissing - baseTokensOwned);

        return {
            baseTokensRequired,
            baseTokensOwned,
            baseTokensMissing,
            creditRows,
            totalCreditTokensRequired,
            totalCreditTokensMissing,
            pureTokensFullTotal,
            pureTokensMissingTotal
        };
    }

    function renderNativePureTokenPlan(estimate, purePlan) {
        if (!purePlan || (!purePlan.creditRows.length && purePlan.baseTokensRequired <= 0)) return "";
        const guildTokenName = itemName("/items/guild_token");
        const rows = purePlan.creditRows.map(row => {
            const creditName = itemName(row.itemHrid);
            const rateText = nativeText("exchangeRate", {
                items: `${nativeFormatNumber(row.rule.guildTokenCount)} ${nativeText("guildTokens")}`,
                credits: nativeCreditQuantity(row.rule.creditCount)
            });
            const neededCreditText = nativeText("nativeUpgradeNeedQuantity", {
                count: nativeCreditQuantity(row.requiredCredits)
            });
            const missingCreditSuffix = row.missingCredits > 0
                ? ` (${nativeText("nativeUpgradeMissingQuantity", { count: nativeCreditQuantity(row.missingCredits) })})`
                : "";
            const neededTokensText = nativeText("nativeUpgradeNeedQuantity", {
                count: `${nativeFormatNumber(row.fullTokens)} ${nativeText("guildTokens")}`
            });
            const missingTokensSuffix = row.missingTokens > 0
                ? ` (${nativeText("nativeUpgradeMissingQuantity", { count: nativeFormatNumber(row.missingTokens) })})`
                : "";
            return `<div class="mwi-native-cost-detail-row mwi-native-pure-token-row">`
                + `<span>${nativeIconMarkup(row.itemHrid, creditName)}<b>${escapeHtml(creditName)}</b></span>`
                + `<small>${escapeHtml(neededCreditText + missingCreditSuffix)}</small>`
                + `<small>${escapeHtml(rateText)}</small>`
                + `<strong>${escapeHtml(neededTokensText + missingTokensSuffix)}</strong>`
                + `</div>`;
        });

        if (purePlan.baseTokensRequired > 0) {
            const baseLabel = nativeText("nativeUpgradeBaseTokens");
            const neededBaseText = nativeText("nativeUpgradeNeedQuantity", {
                count: `${nativeFormatNumber(purePlan.baseTokensRequired)} ${nativeText("guildTokens")}`
            });
            const missingBaseSuffix = purePlan.baseTokensMissing > 0
                ? ` (${nativeText("nativeUpgradeMissingQuantity", { count: nativeFormatNumber(purePlan.baseTokensMissing) })})`
                : "";
            rows.unshift(`<div class="mwi-native-cost-detail-row mwi-native-pure-token-row">`
                + `<span>${nativeIconMarkup("/items/guild_token", guildTokenName)}<b>${escapeHtml(baseLabel)}</b></span>`
                + `<small>${escapeHtml(nativeText("nativeUpgradeBaseTokenDirect"))}</small>`
                + `<small>-</small>`
                + `<strong>${escapeHtml(neededBaseText + missingBaseSuffix)}</strong>`
                + `</div>`);
        }

        const summaryText = nativeText("pureTokenTotalSummary", {
            count: `${nativeFormatNumber(purePlan.pureTokensFullTotal)} ${nativeText("guildTokens")}`
        });
        const missingSummaryText = purePlan.pureTokensMissingTotal < purePlan.pureTokensFullTotal
            ? ` · ${nativeText("pureTokenPlanMissingSummary", { count: `${nativeFormatNumber(purePlan.pureTokensMissingTotal)} ${nativeText("guildTokens")}` })}`
            : "";

        return `<div class="mwi-native-cost-details mwi-native-pure-token-details">`
            + `<div class="mwi-native-cost-detail-title">${escapeHtml(nativeText("nativeUpgradePureTokenPlan"))}</div>`
            + `${rows.join("")}`
            + `<div class="mwi-native-pure-token-summary">`
            + `<span>${escapeHtml(nativeText("pureTokenSummaryLabel"))}</span>`
            + `<strong>${escapeHtml(summaryText + missingSummaryText)}</strong>`
            + `</div>`
            + `</div>`;
    }

    function updateNativeCostsDomTooltips(modalData, purePlan) {
        if (!modalData?.costs?.isConnected || !purePlan) return;
        const containers = modalData.costs.querySelectorAll('[class*="Item_itemContainer"]');
        for (const container of containers) {
            const hrid = itemHridFromNode(container);
            if (!hrid) continue;
            if (hrid === "/items/guild_token") {
                const title = nativeLocale() === "zh-CN"
                    ? `基础消耗：需 ${nativeFormatNumber(purePlan.baseTokensRequired)} 公会代币`
                      + (purePlan.baseTokensMissing > 0 ? `（缺 ${nativeFormatNumber(purePlan.baseTokensMissing)}）` : "")
                    : `Base Cost: Need ${nativeFormatNumber(purePlan.baseTokensRequired)} Guild Tokens`
                      + (purePlan.baseTokensMissing > 0 ? ` (Missing ${nativeFormatNumber(purePlan.baseTokensMissing)})` : "");
                container.setAttribute("title", title);
                continue;
            }
            const creditRow = purePlan.creditRows.find(row => row.itemHrid === hrid);
            if (!creditRow) continue;
            const title = nativeLocale() === "zh-CN"
                ? `${itemName(hrid)}：需 ${nativeCreditQuantity(creditRow.requiredCredits)}`
                  + ` · 兑换需 ${nativeFormatNumber(creditRow.fullTokens)} 公会代币`
                  + (creditRow.missingTokens > 0 ? `（缺口还需 ${nativeFormatNumber(creditRow.missingTokens)} 代币）` : "")
                : `${itemName(hrid)}: Need ${nativeCreditQuantity(creditRow.requiredCredits)}`
                  + ` · Token exchange: ${nativeFormatNumber(creditRow.fullTokens)} Guild Tokens`
                  + (creditRow.missingTokens > 0 ? ` (Missing: ${nativeFormatNumber(creditRow.missingTokens)})` : "");
            container.setAttribute("title", title);
        }
    }

    function nativeGuildBuffViewport() {
        const visualViewport = PAGE_WINDOW.visualViewport;
        const width = Number(visualViewport?.width)
            || Number(PAGE_WINDOW.innerWidth)
            || Number(document.documentElement?.clientWidth)
            || 1;
        const height = Number(visualViewport?.height)
            || Number(PAGE_WINDOW.innerHeight)
            || Number(document.documentElement?.clientHeight)
            || 1;
        return { width: Math.max(1, width), height: Math.max(1, height) };
    }

    function setFloatingCostPosition(state, box, left, top) {
        if (!box?.isConnected) return;
        const viewport = nativeGuildBuffViewport();
        const rect = box.getBoundingClientRect();
        const width = Math.max(1, rect.width || box.offsetWidth || 1);
        const height = Math.max(1, rect.height || box.offsetHeight || 1);
        const margin = viewport.width <= 520 ? 8 : 12;
        const maxLeft = Math.max(margin, viewport.width - width - margin);
        const maxTop = Math.max(margin, viewport.height - height - margin);
        const requestedLeft = Number(left);
        const requestedTop = Number(top);
        const nextLeft = Math.round(Math.min(maxLeft, Math.max(margin, Number.isFinite(requestedLeft) ? requestedLeft : margin)));
        const nextTop = Math.round(Math.min(maxTop, Math.max(margin, Number.isFinite(requestedTop) ? requestedTop : margin)));
        box.style.left = `${nextLeft}px`;
        box.style.top = `${nextTop}px`;
        box.style.right = "auto";
        box.style.bottom = "auto";
        state.position = { left: nextLeft, top: nextTop };
    }

    function positionFloatingCostBox(state, box, anchor) {
        if (!box?.isConnected) return;
        if (state.positionInitialized) {
            const position = state.position || { left: 12, top: 12 };
            setFloatingCostPosition(state, box, position.left, position.top);
            return;
        }

        const viewport = nativeGuildBuffViewport();
        const boxRect = box.getBoundingClientRect();
        const width = Math.max(1, boxRect.width || box.offsetWidth || 1);
        const height = Math.max(1, boxRect.height || box.offsetHeight || 1);
        const margin = viewport.width <= 520 ? 8 : 12;
        const gap = 14;
        const anchorRect = anchor?.getBoundingClientRect?.();
        const usableAnchor = anchorRect
            && anchorRect.width > 0
            && anchorRect.height > 0;
        const candidates = [];
        const addCandidate = (left, top) => {
            if (Number.isFinite(left) && Number.isFinite(top)) candidates.push({ left, top });
        };

        const topRight = () => addCandidate(viewport.width - width - margin, margin);
        const topLeft = () => addCandidate(margin, margin);
        const bottomRight = () => addCandidate(viewport.width - width - margin, viewport.height - height - margin);
        const bottomLeft = () => addCandidate(margin, viewport.height - height - margin);

        if (viewport.width <= 720) {
            topRight();
            topLeft();
        }
        if (usableAnchor) {
            addCandidate(anchorRect.right + gap, anchorRect.top);
            addCandidate(anchorRect.left - width - gap, anchorRect.top);
            addCandidate(anchorRect.left, anchorRect.bottom + gap);
            addCandidate(anchorRect.left, anchorRect.top - height - gap);
        }
        if (viewport.width > 720) {
            topRight();
            topLeft();
        }
        bottomRight();
        bottomLeft();

        const fits = candidate => {
            const withinViewport = candidate.left >= margin
                && candidate.top >= margin
                && candidate.left + width <= viewport.width - margin
                && candidate.top + height <= viewport.height - margin;
            if (!withinViewport || !usableAnchor) return withinViewport;
            const overlapsAnchor = candidate.left < anchorRect.right
                && candidate.left + width > anchorRect.left
                && candidate.top < anchorRect.bottom
                && candidate.top + height > anchorRect.top;
            return !overlapsAnchor;
        };
        const selected = candidates.find(fits)
            || { left: viewport.width - width - margin, top: margin };
        state.positionInitialized = true;
        setFloatingCostPosition(state, box, selected.left, selected.top);
    }

    function finishFloatingCostDrag(state) {
        const drag = state.drag;
        if (!drag) return;
        window.removeEventListener("pointermove", drag.moveHandler, true);
        window.removeEventListener("pointerup", drag.endHandler, true);
        window.removeEventListener("pointercancel", drag.endHandler, true);
        drag.box?.classList.remove("mwi-floating-cost-dragging");
        state.drag = null;
    }

    function installFloatingCostDrag(state, box, titleSelector) {
        if (!box || box.dataset.dragReady === "true") return;
        box.dataset.dragReady = "true";
        box.addEventListener("pointerdown", event => {
            const title = event.target?.closest?.(titleSelector);
            if (!title || !box.contains(title)) return;
            if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
            finishFloatingCostDrag(state);
            const rect = box.getBoundingClientRect();
            const drag = {
                box,
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                moveHandler: null,
                endHandler: null
            };
            const moveHandler = moveEvent => {
                if (moveEvent.pointerId !== drag.pointerId || !box.isConnected) return;
                setFloatingCostPosition(
                    state,
                    box,
                    moveEvent.clientX - drag.offsetX,
                    moveEvent.clientY - drag.offsetY
                );
                moveEvent.preventDefault();
            };
            const endHandler = endEvent => {
                if (endEvent.pointerId !== drag.pointerId) return;
                finishFloatingCostDrag(state);
            };
            drag.moveHandler = moveHandler;
            drag.endHandler = endHandler;
            state.drag = drag;
            state.positionInitialized = true;
            box.classList.add("mwi-floating-cost-dragging");
            window.addEventListener("pointermove", moveHandler, true);
            window.addEventListener("pointerup", endHandler, true);
            window.addEventListener("pointercancel", endHandler, true);
            try { title.setPointerCapture?.(event.pointerId); } catch (error) { /* Optional pointer capture. */ }
            event.preventDefault();
            event.stopPropagation();
        });
    }

    function removeFloatingCostBox(state, selector, legacySelector) {
        finishFloatingCostDrag(state);
        const boxes = new Set(document.querySelectorAll(selector));
        if (state.box) boxes.add(state.box);
        for (const box of boxes) box.remove();
        if (legacySelector) {
            for (const box of document.querySelectorAll(legacySelector)) box.remove();
        }
        state.box = null;
        state.position = null;
        state.positionInitialized = false;
    }

    function removeNativeGuildBuffCostBox() {
        removeFloatingCostBox(nativeGuildBuffCostState, ".mwi-listing-native-guild-buff-cost", ".mwi-shrine-upgrade-cost");
    }

    function ensureNativeGuildBuffCostBox(modalData) {
        if (!document.body) return null;
        let box = nativeGuildBuffCostState.box?.isConnected
            ? nativeGuildBuffCostState.box
            : document.querySelector(".mwi-listing-native-guild-buff-cost");
        if (!box) {
            box = document.createElement("section");
            box.className = "mwi-native-guild-buff-cost";
            box.setAttribute("aria-live", "polite");
        }
        box.classList.add("mwi-listing-native-guild-buff-cost");
        if (box.parentElement !== document.body) document.body.appendChild(box);
        for (const oldBox of document.querySelectorAll(".mwi-listing-native-guild-buff-cost")) {
            if (oldBox !== box) oldBox.remove();
        }
        for (const oldBox of modalData.content.querySelectorAll(".mwi-shrine-upgrade-cost")) oldBox.remove();
        nativeGuildBuffCostState.box = box;
        installFloatingCostDrag(nativeGuildBuffCostState, box, ".mwi-native-cost-title");
        return box;
    }

    function renderNativeGuildBuffCost(modalData, estimate, status, purchasePlans) {
        if (!modalData?.content?.isConnected) return;
        const box = ensureNativeGuildBuffCostBox(modalData);
        if (!box) return;
        const referenceKey = nativePriceReference();
        const reference = nativeText(referenceKey === "b" ? "priceReferenceB" : "priceReferenceA");
        const title = nativeText("nativeUpgradeCostTitle", { reference });
        const note = nativeText(referenceKey === "b" ? "priceReferenceCostNoteB" : "priceReferenceCostNoteA");
        let markup;
        if (status === "loading") {
            markup = `<div class="mwi-native-cost-title">${escapeHtml(title)}</div><div class="mwi-native-cost-status">${escapeHtml(nativeText("nativeUpgradeCalculating"))}</div>`;
        } else if (!estimate) {
            markup = `<div class="mwi-native-cost-title">${escapeHtml(title)}</div><div class="mwi-native-cost-status mwi-native-cost-warning">${escapeHtml(nativeText("nativeUpgradeUnavailable"))}</div>`;
        } else {
            const purePlan = calculatePureGuildTokenPlan(estimate);
            const fullCost = nativeUpgradeCostValue(estimate.totalGold, estimate.guildTokensRequired);
            const additionalCost = nativeUpgradeCostValue(estimate.missingGold, estimate.guildTokensMissing);
            const pureFullCostText = `${nativeFormatNumber(purePlan.pureTokensFullTotal)} ${nativeText("guildTokens")}`;
            const pureMissingCostText = `${nativeFormatNumber(purePlan.pureTokensMissingTotal)} ${nativeText("guildTokens")}`;

            const pureTokenRows = purePlan.creditRows.length > 0 || purePlan.baseTokensRequired > 0 ? (
                `<div class="mwi-native-cost-row mwi-native-cost-row-pure-token"><span>${escapeHtml(nativeText("nativeUpgradePureTokenCost"))}</span><strong>${escapeHtml(pureFullCostText)}</strong></div>`
                + `<div class="mwi-native-cost-row mwi-native-cost-row-pure-token"><span>${escapeHtml(nativeText("nativeUpgradePureTokenMissing"))}</span><strong>${escapeHtml(pureMissingCostText)}</strong></div>`
            ) : "";

            const purchasePlanHtml = renderNativeCreditPurchasePlans(estimate, purchasePlans);
            const pureTokenPlanHtml = renderNativePureTokenPlan(estimate, purePlan);

            markup = `<div class="mwi-native-cost-title">${escapeHtml(title)}</div>`
                + `<div class="mwi-native-cost-row"><span>${escapeHtml(nativeText("nativeUpgradeFullCost"))}</span><strong>${escapeHtml(fullCost)}</strong></div>`
                + `<div class="mwi-native-cost-row"><span>${escapeHtml(nativeText("nativeUpgradeAdditionalCost"))}</span><strong>${escapeHtml(additionalCost)}</strong></div>`
                + pureTokenRows
                + purchasePlanHtml
                + pureTokenPlanHtml
                + `<div class="mwi-native-cost-note">${escapeHtml(note)}</div>`;
        }
        if (box.dataset.signature !== markup) {
            box.dataset.signature = markup;
            box.innerHTML = markup;
        }
        positionFloatingCostBox(nativeGuildBuffCostState, box, modalData.modal);
    }

    async function refreshNativeGuildBuffCost() {
        const refreshId = ++nativeGuildBuffRefreshId;
        const modalData = findNativeGuildBuffModal();
        if (!modalData) {
            observeNativeGuildBuffModal(null);
            removeNativeGuildBuffCostBox();
            return false;
        }
        observeNativeGuildBuffModal(modalData.modal);
        ensureNativeGuildBuffCostStyles();
        renderNativeGuildBuffCost(modalData, null, "loading");
        try {
            const totals = aggregateGuildBuffLevelCosts(
                modalData.entry.detail.levelCosts,
                modalData.startLevel,
                modalData.targetLevel
            );
            if (totals.status !== "ok") throw new Error("Missing guild buff level cost.");
            const requiredCreditHrids = totals.totals
                .map(item => item.itemHrid)
                .filter(itemHrid => CREDIT_HRIDS.has(itemHrid));
            const needsMarketSnapshot = requiredCreditHrids.some(
                itemHrid => !NATIVE_CREDIT_GUILD_TOKEN_OVERRIDES.has(itemHrid)
            );
            let creditUnitCosts = {};
            if (needsMarketSnapshot) {
                const loaded = await ensureUpgradeMarketPrices();
                if (!loaded) throw new Error("Marketplace snapshot unavailable.");
                creditUnitCosts = nativeBestCreditUnitCosts();
            }
            if (refreshId !== nativeGuildBuffRefreshId || !modalData.content.isConnected) return false;
            const estimate = estimateGuildUpgradeCosts(totals.totals, creditUnitCosts, inventoryCounts());
            const fullPurchasePlans = needsMarketSnapshot ? nativeCreditPurchasePlans(estimate, "required") : {};
            const missingPurchasePlans = needsMarketSnapshot ? nativeCreditPurchasePlans(estimate, "missing") : {};
            const displayEstimate = withNativePurchasePlanCosts(estimate, fullPurchasePlans, missingPurchasePlans);
            renderNativeGuildBuffCost(modalData, displayEstimate, "ready", missingPurchasePlans);
            updateNativeCostsDomTooltips(modalData, calculatePureGuildTokenPlan(displayEstimate));
            upgradeCostState.lastError = "";
            return estimate.status === "ok";
        } catch (error) {
            upgradeCostState.lastError = String(error?.message || error);
            if (refreshId === nativeGuildBuffRefreshId && modalData.content.isConnected) {
                try {
                    const fallbackTotals = aggregateGuildBuffLevelCosts(
                        modalData.entry.detail.levelCosts,
                        modalData.startLevel,
                        modalData.targetLevel
                    );
                    if (fallbackTotals.status === "ok") {
                        const fallbackEstimate = estimateGuildUpgradeCosts(fallbackTotals.totals, {}, inventoryCounts());
                        renderNativeGuildBuffCost(modalData, fallbackEstimate, "ready", {});
                        updateNativeCostsDomTooltips(modalData, calculatePureGuildTokenPlan(fallbackEstimate));
                        return true;
                    }
                } catch (_) { /* Ignore fallback failure. */ }
                renderNativeGuildBuffCost(modalData, null, "error");
            } else if (refreshId === nativeGuildBuffRefreshId) {
                removeNativeGuildBuffCostBox();
            }
            return false;
        }
    }

    function scheduleNativeGuildBuffCost() {
        window.clearTimeout(nativeGuildBuffRefreshTimer);
        nativeGuildBuffRefreshTimer = window.setTimeout(() => {
            nativeGuildBuffRefreshTimer = null;
            refreshNativeGuildBuffCost();
        }, 40);
    }

    function observeNativeGuildBuffModal(modal) {
        if (nativeGuildBuffObservedModal === modal) return;
        nativeGuildBuffModalObserver?.disconnect();
        nativeGuildBuffObservedModal = modal || null;
        nativeGuildBuffModalObserver = null;
        if (!modal || !modal.isConnected || typeof MutationObserver !== "function") return;
        nativeGuildBuffModalObserver = new MutationObserver(mutations => {
            const relevant = [...(mutations || [])].some(mutation => {
                const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
                if (target?.closest?.(".mwi-native-guild-buff-cost")) return false;
                return mutation.type === "characterData"
                    || [...(mutation.addedNodes || [])].some(node => node.nodeType === 1)
                    || [...(mutation.removedNodes || [])].some(node => node.nodeType === 1);
            });
            if (relevant) scheduleNativeGuildBuffCost();
        });
        nativeGuildBuffModalObserver.observe(modal, { childList: true, subtree: true, characterData: true });
    }

    function nodeMayContainNativeGuildBuffModal(node) {
        if (!node || node.nodeType !== 1) return false;
        const selector = '[class*="GuildPanel_guildModalContent"]';
        return node.matches(selector) || Boolean(node.querySelector(selector));
    }

    function ensureNativeGuildBuffCostStyles() {
        if (document.getElementById(NATIVE_GUILD_BUFF_COST_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = NATIVE_GUILD_BUFF_COST_STYLE_ID;
        style.textContent = `
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost{position:fixed;z-index:2147483000;box-sizing:border-box;display:grid;gap:4px;width:min(440px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);margin:0;padding:8px 10px;border:1px solid #3d8d80;border-radius:7px;background:#1d3937;color:#eefbf8;font:12px/1.3 system-ui,-apple-system,"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35),inset 3px 0 #4fcdb5;overflow:auto;resize:both;touch-action:pan-x pan-y pinch-zoom;overscroll-behavior:contain;pointer-events:auto}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-title{display:flex;align-items:center;min-height:20px;color:#8fe4d4;font-size:12px;font-weight:700;cursor:grab;touch-action:none;user-select:none}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost.mwi-floating-cost-dragging .mwi-native-cost-title{cursor:grabbing}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row span{color:#c8ded9}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row strong{color:#77f3d0;font-size:13px;text-align:right}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row.mwi-native-cost-row-pure-token strong{color:#ffd17c}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-details{display:grid;gap:4px;min-width:0;margin-top:2px;padding-top:5px;border-top:1px solid #35665f}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-title{color:#8fe4d4;font-size:12px;font-weight:700}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center;gap:2px 6px;min-width:0;overflow-wrap:anywhere;color:#dff7f2;font-size:11px}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row span{display:flex;align-items:center;gap:4px;min-width:0}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row b{min-width:0}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row small{color:#c8ded9}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row strong{grid-column:1/-1;color:#77f3d0;text-align:right}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row.mwi-native-pure-token-row span{grid-column:1/-1}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row.mwi-native-pure-token-row strong{color:#ffd17c}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-row em{color:#ffd17c;font-style:normal}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-detail-empty{color:#c8ded9;font-size:11px}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-pure-token-summary{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-top:2px;padding-top:4px;border-top:1px dashed #35665f;font-size:11px;color:#c8ded9}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-pure-token-summary strong{color:#ffd17c;font-size:12px;text-align:right;overflow-wrap:anywhere}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-item-icon{width:16px;height:16px;flex:0 0 16px}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-note{color:#d9bd78;font-size:10px}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-status{color:#c8ded9}
            .mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-warning{color:#ffd17c}
            @media (max-width:520px){.mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row{align-items:flex-start;flex-direction:column;gap:2px}.mwi-native-guild-buff-cost.mwi-listing-native-guild-buff-cost .mwi-native-cost-row strong{text-align:left}}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function startNativeGuildBuffCost() {
        if (!document.body || nativeGuildBuffRootObserver || typeof MutationObserver !== "function") return;
        ensureNativeGuildBuffCostStyles();
        if (!nativeGuildBuffCostResizeHandler) {
            nativeGuildBuffCostResizeHandler = () => {
                for (const state of [nativeGuildBuffCostState, houseUpgradeCostState]) {
                    if (!state.box?.isConnected) continue;
                    const position = state.position || { left: 12, top: 12 };
                    setFloatingCostPosition(state, state.box, position.left, position.top);
                }
            };
            window.addEventListener("resize", nativeGuildBuffCostResizeHandler, { passive: true });
            PAGE_WINDOW.visualViewport?.addEventListener?.("resize", nativeGuildBuffCostResizeHandler, { passive: true });
        }
        nativeGuildBuffRootObserver = new MutationObserver(mutations => {
            if (nativeGuildBuffObservedModal && !nativeGuildBuffObservedModal.isConnected) {
                scheduleNativeGuildBuffCost();
                return;
            }
            if ([...(mutations || [])].some(mutation => (
                [...(mutation.addedNodes || [])].some(nodeMayContainNativeGuildBuffModal)
            ))) scheduleNativeGuildBuffCost();
        });
        nativeGuildBuffRootObserver.observe(document.body, { childList: true, subtree: true });
        scheduleNativeGuildBuffCost();
    }

    function ensureUpgradeCostStyles() {
        if (document.getElementById("mwi-upgrade-cost-style")) return;
        const style = document.createElement("style");
        style.id = "mwi-upgrade-cost-style";
        style.textContent = `
            .mwi-upgrade-cost-panel{display:grid;gap:4px;margin:12px 0 4px;padding:8px 10px;border:1px solid #3d8d80;border-radius:7px;background:#1d3937;color:#eefbf8;font:12px/1.3 system-ui,-apple-system,"Microsoft YaHei",sans-serif;box-shadow:inset 3px 0 #4fcdb5}
            .mwi-listing-upgrade-cost-title,.mwi-upgrade-cost-detail-title{color:#8fe4d4;font-size:12px;font-weight:700}
            .mwi-upgrade-cost-total{display:flex;align-items:baseline;justify-content:space-between;gap:6px}.mwi-upgrade-cost-total span{color:#c8ded9}.mwi-upgrade-cost-total strong{color:#77f3d0;font-size:13px;text-align:right;overflow-wrap:anywhere}
            .mwi-upgrade-cost-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:baseline;gap:8px;padding-top:3px;border-top:1px solid #35665f}.mwi-upgrade-cost-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mwi-upgrade-cost-row small{color:#c8ded9;white-space:nowrap}.mwi-upgrade-cost-row b{color:#77f3d0;white-space:nowrap}
            @media(max-width:560px){.mwi-upgrade-cost-row{grid-template-columns:minmax(0,1fr) auto}.mwi-upgrade-cost-row small{grid-column:1}.mwi-upgrade-cost-row b{grid-column:2;grid-row:1/3}}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function ensureHouseUpgradeCostStyles() {
        if (document.getElementById(HOUSE_UPGRADE_COST_STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = HOUSE_UPGRADE_COST_STYLE_ID;
        style.textContent = `
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS}{position:fixed;z-index:2147482990;box-sizing:border-box;width:min(440px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);margin:0;overflow:auto;resize:both;touch-action:pan-x pan-y pinch-zoom;overscroll-behavior:contain;box-shadow:0 8px 24px rgba(0,0,0,.35),inset 3px 0 #4fcdb5;pointer-events:auto}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS} .mwi-listing-upgrade-cost-title{display:flex;align-items:center;min-height:20px;cursor:grab;touch-action:none;user-select:none}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS}.mwi-floating-cost-dragging .mwi-listing-upgrade-cost-title{cursor:grabbing}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS} .mwi-upgrade-cost-row{min-width:0;grid-template-columns:minmax(0,1fr) auto;gap:2px 6px;padding-top:2px}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS} .mwi-upgrade-cost-row span{overflow:visible;white-space:normal;overflow-wrap:anywhere}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS} .mwi-upgrade-cost-row small{grid-column:1/-1;grid-row:2;white-space:normal;overflow-wrap:anywhere}
            .mwi-upgrade-cost-panel.${HOUSE_UPGRADE_COST_CLASS} .mwi-upgrade-cost-row b{grid-column:2;grid-row:1;white-space:normal;text-align:right}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function removeHouseUpgradeCostBox() {
        removeFloatingCostBox(
            houseUpgradeCostState,
            `.${HOUSE_UPGRADE_COST_CLASS}`,
            '[class*="HousePanel_modalContent"] .mwi-house-upgrade-cost'
        );
    }

    function ensureHouseUpgradeCostBox(panel) {
        if (!document.body) return null;
        let box = houseUpgradeCostState.box?.isConnected
            ? houseUpgradeCostState.box
            : document.querySelector(`.${HOUSE_UPGRADE_COST_CLASS}`);
        if (!box) {
            box = document.createElement("section");
            box.className = `mwi-upgrade-cost-panel mwi-house-upgrade-cost ${HOUSE_UPGRADE_COST_CLASS}`;
        }
        box.classList.add("mwi-upgrade-cost-panel", "mwi-house-upgrade-cost", HOUSE_UPGRADE_COST_CLASS);
        if (box.parentElement !== document.body) document.body.appendChild(box);
        for (const oldBox of document.querySelectorAll(`.${HOUSE_UPGRADE_COST_CLASS}`)) {
            if (oldBox !== box) oldBox.remove();
        }
        for (const oldBox of panel.querySelectorAll(".mwi-house-upgrade-cost")) {
            if (oldBox !== box) oldBox.remove();
        }
        houseUpgradeCostState.box = box;
        installFloatingCostDrag(houseUpgradeCostState, box, ".mwi-listing-upgrade-cost-title");
        return box;
    }

    function renderHouseCost(panel) {
        const rows = parseHouseRequirements(panel).map(row => ({ ...row, unitPrice: row.itemHrid === "/items/coin" ? 1 : marketPrice(row.itemHrid) }));
        if (!rows.length) {
            removeHouseUpgradeCostBox();
            return;
        }
        const box = ensureHouseUpgradeCostBox(panel);
        if (!box) return;
        const markup = renderUpgradeCostRows(rows, `mwi-upgrade-cost-panel mwi-house-upgrade-cost ${HOUSE_UPGRADE_COST_CLASS}`);
        if (box.dataset.signature !== markup) {
            const template = document.createElement("template");
            template.innerHTML = markup;
            const rendered = template.content.firstElementChild;
            if (!rendered) return;
            const dragging = box.classList.contains("mwi-floating-cost-dragging");
            box.dataset.signature = markup;
            box.className = rendered.className;
            if (dragging) box.classList.add("mwi-floating-cost-dragging");
            box.innerHTML = rendered.innerHTML;
        }
        positionFloatingCostBox(
            houseUpgradeCostState,
            box,
            panel
        );
    }

    async function refreshUpgradeCosts() {
        const refreshId = ++upgradeCostState.refreshId;
        let house = null;
        try {
            syncUpgradeDataFromPage();
            upgradeCostState.lastSyncAt = Date.now();
            house = housePanel();
            if (!house) {
                removeHouseUpgradeCostBox();
                return;
            }
            ensureUpgradeCostStyles();
            ensureHouseUpgradeCostStyles();

            if (visible(house)) renderHouseCost(house);

            await ensureUpgradeMarketPrices();
            if (refreshId !== upgradeCostState.refreshId) return;
            if (house.isConnected && visible(house)) renderHouseCost(house);
            else removeHouseUpgradeCostBox();
            upgradeCostState.lastRefreshAt = Date.now();
            upgradeCostState.lastError = "";
        } catch (error) {
            upgradeCostState.lastError = String(error?.stack || error?.message || error);
            if (refreshId === upgradeCostState.refreshId && !house?.isConnected) removeHouseUpgradeCostBox();
            console.warn("[MWI Listing Notifier] upgrade cost refresh failed:", error);
        }
    }

    function scheduleUpgradeCostRefresh() {
        clearTimeout(upgradeCostState.refreshTimer);
        upgradeCostState.refreshTimer = setTimeout(() => { upgradeCostState.refreshTimer = null; refreshUpgradeCosts(); }, 80);
        scheduleNativeGuildBuffCost();
    }

    function startUpgradeCostObserver() {
        if (upgradeCostState.rootObserver || typeof MutationObserver !== "function") {
            startNativeGuildBuffCost();
            return;
        }
        ensureUpgradeCostStyles();
        upgradeCostState.rootObserver = new MutationObserver(mutations => {
            const relevant = mutations.some(mutation => {
                const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
                if (target?.closest?.(".mwi-upgrade-cost-panel, .mwi-native-guild-buff-cost")) return false;
                const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
                return !nodes.length || nodes.some(node => {
                    const element = node?.nodeType === 1 ? node : node?.parentElement;
                    return !element?.matches?.(".mwi-upgrade-cost-panel, .mwi-native-guild-buff-cost")
                        && !element?.closest?.(".mwi-upgrade-cost-panel, .mwi-native-guild-buff-cost");
                });
            });
            if (relevant) scheduleUpgradeCostRefresh();
        });
        upgradeCostState.rootObserver.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
        setInterval(scheduleUpgradeCostRefresh, 1200);
        document.addEventListener("click", scheduleUpgradeCostRefresh, true);
        document.addEventListener("pointerdown", scheduleUpgradeCostRefresh, true);
        startNativeGuildBuffCost();
        scheduleUpgradeCostRefresh();
    }

    function toFiniteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function formatNumber(value, digits) {
        return new Intl.NumberFormat("zh-CN", {
            maximumFractionDigits: digits === undefined ? 0 : digits
        }).format(toFiniteNumber(value));
    }

    function listingIdOf(listing) {
        const id = listing?.id ?? listing?.marketListingId;
        return id == null ? "" : String(id);
    }

    function snapshotOf(listing) {
        return {
            filledQuantity: toFiniteNumber(listing?.filledQuantity),
            unclaimedCoinCount: toFiniteNumber(listing?.unclaimedCoinCount),
            unclaimedItemCount: toFiniteNumber(listing?.unclaimedItemCount)
        };
    }

    function hasChinese(text) {
        return /[\u3400-\u9fff]/.test(String(text || ""));
    }

    function resolveItemName(listing) {
        const hrid = String(listing?.itemHrid || "");
        const bareId = hrid.replace(/^\/items\//, "");
        const directName = String(listing?.itemName || listing?.name || "");

        try {
            const chineseName = PAGE_WINDOW.mwi?.lang?.zh?.translation?.itemNames?.[hrid];
            if (chineseName) return String(chineseName);
        } catch (error) { /* The optional Chinese dictionary may not be loaded. */ }

        try {
            const marketMateName = PAGE_WINDOW.MWIMM?.resolveItemName?.(bareId);
            if (hasChinese(marketMateName)) return String(marketMateName);
        } catch (error) { /* Market Mate is optional. */ }

        try {
            const clientName = PAGE_WINDOW.mwi?.initClientData?.itemDetailMap?.[hrid]?.name;
            if (hasChinese(clientName)) return String(clientName);
        } catch (error) { /* Client data may not be exposed globally. */ }

        if (hasChinese(directName)) return directName;
        if (directName) return directName;
        return bareId ? bareId.replace(/_/g, " ") : "未知物品";
    }

    function itemLabel(listing) {
        const name = resolveItemName(listing);
        const level = Number(listing?.enhancementLevel);
        return Number.isFinite(level) && level > 0 ? `${name} +${level}` : name;
    }

    function ensureToastStyles() {
        if (document.getElementById("mwi-listing-notifier-style")) return;
        const style = document.createElement("style");
        style.id = "mwi-listing-notifier-style";
        style.textContent = `
            #mwi-listing-notifier-toasts {
                position: fixed;
                right: 16px;
                top: 16px;
                z-index: 2147483647;
                display: grid;
                width: min(380px, calc(100vw - 32px));
                gap: 8px;
                pointer-events: none;
            }
            .mwi-listing-notifier-toast {
                padding: 12px 14px;
                border: 1px solid #4f9d78;
                border-left: 4px solid #69d29d;
                border-radius: 7px;
                background: #151a1d;
                color: #f4f7f5;
                box-shadow: 0 8px 24px rgba(0, 0, 0, .42);
                font: 13px/1.5 system-ui, -apple-system, "Microsoft YaHei", sans-serif;
                pointer-events: auto;
                cursor: pointer;
            }
            .mwi-listing-notifier-toast strong {
                display: block;
                margin-bottom: 3px;
                color: #82e7b4;
                font-size: 14px;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showPageToast(title, message) {
        const render = () => {
            if (!document.body) return;
            ensureToastStyles();
            let container = document.getElementById("mwi-listing-notifier-toasts");
            if (!container) {
                container = document.createElement("div");
                container.id = "mwi-listing-notifier-toasts";
                document.body.appendChild(container);
            }

            const toast = document.createElement("div");
            toast.className = "mwi-listing-notifier-toast";
            const heading = document.createElement("strong");
            const body = document.createElement("span");
            heading.textContent = title;
            body.textContent = message;
            toast.append(heading, body);
            toast.addEventListener("click", () => {
                toast.remove();
                clearUnread();
            });
            container.prepend(toast);
            while (container.children.length > 4) container.lastElementChild?.remove();
            window.setTimeout(() => toast.remove(), 12000);
        };

        if (document.body) render();
        else document.addEventListener("DOMContentLoaded", render, { once: true });
    }

    function faviconLinks() {
        return [...document.querySelectorAll('link[rel~="icon"]')];
    }

    function drawUnreadFavicon(sourceHref) {
        return new Promise(resolve => {
            const fallbackBadge = "data:image/svg+xml," + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="13" cy="13" r="10" fill="#ef233c" stroke="#fff" stroke-width="4"/></svg>'
            );
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 64;
            const context = canvas.getContext("2d");
            if (!context) {
                resolve(fallbackBadge);
                return;
            }

            const finish = image => {
                context.clearRect(0, 0, 64, 64);
                if (image) context.drawImage(image, 0, 0, 64, 64);
                context.beginPath();
                context.arc(13, 13, 11, 0, Math.PI * 2);
                context.fillStyle = "#ef233c";
                context.fill();
                context.lineWidth = 4;
                context.strokeStyle = "#ffffff";
                context.stroke();
                try { resolve(canvas.toDataURL("image/png")); }
                catch (error) { resolve(fallbackBadge); }
            };

            if (!sourceHref) {
                finish(null);
                return;
            }

            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => finish(image);
            image.onerror = () => finish(null);
            image.src = new URL(sourceHref, location.href).href;
        });
    }

    async function markUnread() {
        unread = true;
        if (!document.title.startsWith("● ")) document.title = `● ${document.title}`;

        let links = faviconLinks();
        if (links.length === 0) {
            const link = document.createElement("link");
            link.rel = "icon";
            (document.head || document.documentElement).appendChild(link);
            links = [link];
        }

        for (const link of links) {
            if (!originalFavicons.has(link)) originalFavicons.set(link, link.getAttribute("href"));
        }
        const badgeHref = await drawUnreadFavicon(links[0].href || "/favicon.svg");
        if (!unread || !badgeHref) return;
        for (const link of links) link.href = badgeHref;
    }

    function clearUnread() {
        if (!unread) return;
        unread = false;
        document.title = document.title.replace(/^●\s*/, "");
        for (const [link, originalHref] of originalFavicons) {
            if (!link.isConnected) continue;
            if (originalHref == null) link.remove();
            else link.setAttribute("href", originalHref);
        }
        originalFavicons.clear();
    }

    function sendNotification(title, message) {
        markUnread();
        showPageToast(title, message);
    }

    function buildFillMessage(listing, previous) {
        const filled = toFiniteNumber(listing.filledQuantity);
        const total = toFiniteNumber(listing.orderQuantity);
        const delta = Math.max(0, filled - previous.filledQuantity);
        const completed = total > 0 && filled >= total;
        const progress = total > 0
            ? `${formatNumber(filled)} / ${formatNumber(total)}`
            : formatNumber(filled);
        const prefix = listing.isSell === true ? "卖单" : "收购单";
        const state = completed ? "全部成交" : "部分成交";
        let detail = `${prefix}${state}：${itemLabel(listing)}，本次 ${formatNumber(delta)}，累计 ${progress}`;

        if (listing.isSell === true) {
            const coins = toFiniteNumber(listing.unclaimedCoinCount);
            if (coins > 0) detail += `，待领取 ${formatNumber(coins)} 金币`;
        } else {
            const items = toFiniteNumber(listing.unclaimedItemCount);
            if (items > 0) detail += `，待领取 ${formatNumber(items)} 件`;
        }
        return detail;
    }

    function rememberListings(listings) {
        listingSnapshots.clear();
        for (const listing of listings) {
            const id = listingIdOf(listing);
            if (id) listingSnapshots.set(id, snapshotOf(listing));
        }
        hasInitialListings = true;
    }

    function handleListingUpdates(listings) {
        if (!Array.isArray(listings)) return;
        for (const listing of listings) {
            const id = listingIdOf(listing);
            if (!id) continue;

            const current = snapshotOf(listing);
            const previous = listingSnapshots.get(id);
            listingSnapshots.set(id, current);

            if (!hasInitialListings || !previous) {
                if (hasInitialListings && current.filledQuantity > 0) {
                    sendNotification("MWI 挂牌成交", buildFillMessage(listing, {
                        filledQuantity: 0,
                        unclaimedCoinCount: 0,
                        unclaimedItemCount: 0
                    }));
                }
                continue;
            }

            if (current.filledQuantity > previous.filledQuantity) {
                sendNotification("MWI 挂牌成交", buildFillMessage(listing, previous));
            }
        }
    }

    function handleGameMessage(rawMessage) {
        if (typeof rawMessage !== "string") return;

        try {
            const message = JSON.parse(rawMessage);
            if (message?.type === "market_item_order_books_updated" && !guildCreditOwnsMarketData()) {
                rememberLiveMarketUpdate(normalizeMarketOrderBooksUpdate(message));
            }
            const upgradeDataPresent = /itemDetailMap|itemDetailDict|itemDetails|guildBuffDetailMap|guildBuffDetailDict|guildBuffDetails|characterItems|endCharacterItems/.test(rawMessage);
            if (upgradeDataPresent) {
                mergeUpgradeData(message);
                scheduleUpgradeCostRefresh();
            }
            if (message?.type === "init_character_data") {
                const nextCharacterId = message.character?.id == null ? "" : String(message.character.id);
                if (nextCharacterId !== characterId) characterId = nextCharacterId;
                rememberListings(Array.isArray(message.myMarketListings) ? message.myMarketListings : []);
                return;
            }
            if (message?.type === "market_listings_updated") {
                handleListingUpdates(message.endMarketListings);
                return;
            }
        } catch (error) { /* Ignore non-JSON WebSocket frames. */ }
    }

    function installPageUpgradeSocketTap() {
        const eventName = "__mwiListingNotifierUpgradeMessageV1";
        window.addEventListener(eventName, event => {
            if (typeof event?.detail !== "string") return;
            handleGameMessage(event.detail);
        });
        if (typeof GM_addElement !== "function") return false;
        const source = `;(${function (name) {
            const NativeWebSocket = window.WebSocket;
            if (typeof NativeWebSocket !== "function" || NativeWebSocket.__mwiListingNotifierTap) return;
            const sockets = new WeakSet();
            const isGameSocket = value => {
                try {
                    const url = new URL(String(value || ""));
                    return url.protocol === "wss:" && /^api(?:-test)?\.milkywayidle(?:cn)?\.com$/i.test(url.hostname);
                } catch (error) { return false; }
            };
            const observe = socket => {
                if (!socket || !isGameSocket(socket.url) || sockets.has(socket)) return socket;
                sockets.add(socket);
                socket.addEventListener("message", event => {
                    if (typeof event.data === "string") window.dispatchEvent(new CustomEvent(name, { detail: event.data }));
                });
                return socket;
            };
            function ObservedWebSocket(...args) { return observe(new NativeWebSocket(...args)); }
            ObservedWebSocket.prototype = NativeWebSocket.prototype;
            try { Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket); } catch (error) { /* Optional. */ }
            for (const constant of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
                if (constant in ObservedWebSocket) continue;
                try {
                    Object.defineProperty(ObservedWebSocket, constant, {
                        configurable: true,
                        enumerable: true,
                        value: NativeWebSocket[constant]
                    });
                } catch (error) { /* Optional. */ }
            }
            try { Object.defineProperty(ObservedWebSocket, "__mwiListingNotifierTap", { value: true }); } catch (error) { return; }
            try { window.WebSocket = ObservedWebSocket; } catch (error) { /* Optional. */ }
        }.toString()})(${JSON.stringify(eventName)});`;
        try {
            const script = GM_addElement("script", { textContent: source });
            script?.remove?.();
            return true;
        } catch (error) {
            return false;
        }
    }

    function isGameSocket(rawUrl) {
        try {
            return GAME_WS_HOSTS.has(new URL(String(rawUrl), location.href).hostname);
        } catch (error) {
            return false;
        }
    }

    function installWebSocketHook() {
        const existingHub = PAGE_WINDOW.__mwiListingNotifierHub;
        if (existingHub?.revision === 1 && existingHub.mode === "socket-listener") {
            existingHub.handler = handleGameMessage;
            return;
        }

        const NativeWebSocket = PAGE_WINDOW.WebSocket;
        if (typeof NativeWebSocket !== "function") {
            console.warn("[MWI Listing Notifier] WebSocket is unavailable.");
            return;
        }

        const hub = {
            revision: 1,
            mode: "socket-listener",
            handler: handleGameMessage
        };

        class ListingNotifierWebSocket extends NativeWebSocket {
            constructor(url, protocols) {
                if (arguments.length >= 2) super(url, protocols);
                else super(url);
                if (!isGameSocket(this.url || url)) return;
                NativeWebSocket.prototype.addEventListener.call(this, "message", (event) => {
                    try { hub.handler?.(event.data); } catch (error) {
                        console.warn("[MWI Listing Notifier] message handler failed:", error);
                    }
                });
            }
        }

        PAGE_WINDOW.__mwiListingNotifierHub = hub;
        PAGE_WINDOW.WebSocket = ListingNotifierWebSocket;
    }

    PAGE_WINDOW.MWIListingNotifier = {
        version: VERSION,
        getState() {
            return {
                characterId,
                initialized: hasInitialListings,
                listingCount: listingSnapshots.size,
                unread
            };
        },
        getUpgradeState() {
            const shrine = shrinePanel();
            const house = housePanel();
            return {
                version: VERSION,
                itemDetails: itemDetailEntries().length,
                guildBuffDetails: shrineEntries().length,
                characterItems: Array.isArray(upgradeCostState.characterItems) ? upgradeCostState.characterItems.length : 0,
                conversionCount: [...CREDIT_HRIDS].reduce((total, hrid) => total + conversionEntries(hrid).length, 0),
                marketPriceCount: Object.keys(upgradeCostState.marketPrices || {}).length,
                shrineModal: Boolean(shrine),
                houseModal: Boolean(house),
                shrineCostBox: Boolean(document.querySelector(".mwi-listing-native-guild-buff-cost")),
                houseCostBox: Boolean(document.querySelector(`.${HOUSE_UPGRADE_COST_CLASS}`)),
                lastModalReason: upgradeCostState.lastModalReason,
                lastError: upgradeCostState.lastError,
                lastSyncAt: upgradeCostState.lastSyncAt,
                lastRefreshAt: upgradeCostState.lastRefreshAt
            };
        },
        test() {
            sendNotification("MWI 挂牌成交提醒测试", "通知功能正常。");
        }
    };

    document.addEventListener("pointerdown", clearUnread, true);

    let useGuildCreditSocketFeed = guildCreditSocketFeedAvailable();
    window.addEventListener(GUILD_CREDIT_SOCKET_MESSAGE_EVENT, event => {
        if (!useGuildCreditSocketFeed || typeof event?.detail !== "string") return;
        handleGameMessage(event.detail);
    });
    window.addEventListener(GUILD_CREDIT_SOCKET_READY_EVENT, event => {
        if (event?.detail === "1") useGuildCreditSocketFeed = true;
    }, { once: true });
    window.setTimeout(() => {
        useGuildCreditSocketFeed = useGuildCreditSocketFeed || guildCreditSocketFeedAvailable();
        if (!useGuildCreditSocketFeed && !installPageUpgradeSocketTap()) installWebSocketHook();
    }, 0);

    const startCompatibleMarketDomObserver = () => {
        if (!guildCreditOwnsMarketData()) startMarketDomObserver();
    };
    if (document.documentElement) window.setTimeout(startCompatibleMarketDomObserver, 0);
    else document.addEventListener("DOMContentLoaded", startCompatibleMarketDomObserver, { once: true });
    if (document.body) startUpgradeCostObserver();
    else document.addEventListener("DOMContentLoaded", startUpgradeCostObserver, { once: true });
})();
