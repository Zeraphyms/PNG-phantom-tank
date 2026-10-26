// Web 端主应用逻辑
document.addEventListener("DOMContentLoaded", () => {
    // 状态
    let srcFiles = [];
    let customCoverBlob = null;
    let selectedBgColor = "#000000";
    let lastDisguisedResults = []; // { blob, filename, url }
    let lastRestoredResults = []; // { blob, filename, url, format }
    let restoreFiles = [];
    let splitFiles = [];
    let lastSplitResults = []; // { blob, filename, url }

    // 拖拽目标集合（供全局 drop/dragover 拦截判断使用）
    const dropBoxes = [];

    // 全局拦截：拖到上传框以外的区域时，阻止浏览器默认"打开文件"行为
    ["dragover", "drop"].forEach(evt => {
        window.addEventListener(evt, e => {
            const inside = dropBoxes.some(box => box.contains(e.target));
            if (!inside) e.preventDefault();
        }, false);
    });

    // DOM
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabPages = document.querySelectorAll(".tab-page");

    // 1. Tab 切换
    // 主 Tab 与「更多功能」子功能的页面 id → 名称/路径映射
    // emoji 单独存：功能栏里 emoji 绝对定位在文字左侧，不参与居中计算
    const FEATURE_PAGES = {
        "page-split":     { emoji: "✂️", name: "拆解动图", path: "/split" },
        "page-chaos":     { emoji: "🌀", name: "图片混淆", path: "/chaos" },
        "page-clean":     { emoji: "🧹", name: "清除信息", path: "/clean" },
        "page-weathering":{ emoji: "🏺", name: "电子包浆", path: "/weathering" },
        "page-merge":     { emoji: "🧩", name: "图片处理", path: "/processing" },
        "page-md5":       { emoji: "#️⃣", name: "MD5 工具", path: "/md5" }
    };

    function switchPage(targetId, skipUrlSync = false) {
        tabPages.forEach(p => p.classList.remove("active"));
        const page = document.getElementById(targetId);
        if (page) page.classList.add("active");

        // 非主 Tab 页（更多功能子功能）由「更多功能」菜单承载：
        // 主 Tab 栏换成「功能名 + 回到主页」
        const isFeature = !!FEATURE_PAGES[targetId];
        document.getElementById("main-tab-bar").hidden = isFeature;
        document.getElementById("feature-tab-bar").hidden = !isFeature;
        // 图片处理页的功能名换成子功能切换；其他功能页显示功能名
        const isMerge = targetId === "page-merge";
        document.getElementById("merge-sub-tabs").hidden = !isMerge;
        document.getElementById("txt-feature-name").hidden = isMerge;
        if (isFeature) {
            document.getElementById("txt-feature-emoji").textContent = FEATURE_PAGES[targetId].emoji;
            document.getElementById("txt-feature-text").textContent = FEATURE_PAGES[targetId].name;
        }
        // 「回到主页」按钮在顶栏（夜间模式左边），仅功能页显示
        document.getElementById("btn-header-home").hidden = !isFeature;

        tabBtns.forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-tab") === targetId);
        });
        document.querySelectorAll(".menu-item").forEach(mi => {
            mi.classList.toggle("active", mi.getAttribute("data-tab") === targetId);
        });

        // 地址栏同步：线上点子功能时把路径推进去（可直接复制分享），回主 Tab 清回 /
        // skipUrlSync 供浏览器前进/后退（popstate）复用，避免重复压栈
        if (!skipUrlSync && location.protocol.startsWith("http")) {
            const targetPath = isFeature ? FEATURE_PAGES[targetId].path : "/";
            if (location.pathname !== targetPath) {
                history.pushState({ page: targetId }, "", targetPath);
            }
        }

        if (targetId === "page-history") {
            renderHistory();
        }
    }

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => switchPage(btn.getAttribute("data-tab")));
    });

    // 浏览器前进/后退：按历史记录里的页面 id 还原界面
    window.addEventListener("popstate", (e) => {
        const pid = (e.state && e.state.page) || "page-disguise";
        switchPage(pid, true);
    });

    // 顶栏「回到主页」（夜间模式左边，功能页显示）：回默认页
    document.getElementById("btn-header-home").addEventListener("click", () => switchPage("page-disguise"));

    // 1.0.1 直达路径：启动时按 URL 路径进入对应功能（/split /chaos /clean /weathering /processing）
    // 站点无 404.html，Cloudflare Pages 按 SPA 兜底把所有未知路径 200 返回 index.html，
    // 无需 _redirects（写了反而会因 /index.html 规范化 308 跳回 /）；本地 file:// 不受影响
    (function routeByPath() {
        if (!location.protocol.startsWith("http")) return;
        const p = location.pathname.replace(/\/+$/, "") || "/";
        const hit = Object.entries(FEATURE_PAGES).find(([, f]) => f.path === p);
        if (hit) {
            switchPage(hit[0], true);
            // 直达进入也压一条历史，后退键能回到主页
            history.replaceState({ page: hit[0] }, "", p);
        } else {
            history.replaceState({ page: "page-disguise" }, "", location.pathname);
        }
    })();

    // 1.1 更多功能菜单
    const btnMenuMore = document.getElementById("btn-menu-more");
    const menuMore = document.getElementById("menu-more");

    function closeMenu() {
        menuMore.hidden = true;
        btnMenuMore.setAttribute("aria-expanded", "false");
    }

    btnMenuMore.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = menuMore.hidden;
        menuMore.hidden = !willOpen;
        btnMenuMore.setAttribute("aria-expanded", String(willOpen));
    });

    menuMore.querySelectorAll(".menu-item").forEach(item => {
        item.addEventListener("click", () => {
            switchPage(item.getAttribute("data-tab"));
            closeMenu();
        });
    });

    document.addEventListener("click", (e) => {
        if (!menuMore.hidden && !menuMore.contains(e.target) && !btnMenuMore.contains(e.target)) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeMenu();
    });

    // 1.2 夜间模式（跟随系统，可手动切换并持久化）
    const btnTheme = document.getElementById("btn-theme");
    const mediaDark = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme(dark) {
        document.documentElement.classList.toggle("dark", dark);
        btnTheme.setAttribute("aria-label", dark ? "切换日间模式" : "切换夜间模式");
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", dark ? "#16233A" : "#2563EB");
    }

    function savedTheme() {
        try { return localStorage.getItem("png_web_theme"); } catch (e) { return null; }
    }

    applyTheme(savedTheme() ? savedTheme() === "dark" : mediaDark.matches);

    btnTheme.addEventListener("click", () => {
        const dark = !document.documentElement.classList.contains("dark");
        applyTheme(dark);
        try { localStorage.setItem("png_web_theme", dark ? "dark" : "light"); } catch (e) {}
    });

    // 未手动设置过时，跟随系统变化实时切换
    const onSystemThemeChange = (e) => {
        if (!savedTheme()) applyTheme(e.matches);
    };
    if (mediaDark.addEventListener) {
        mediaDark.addEventListener("change", onSystemThemeChange);
    } else if (mediaDark.addListener) {
        mediaDark.addListener(onSystemThemeChange);
    }

    // 2. 底色配置加载与选择 (localStorage 持久化)
    const savedBgColor = localStorage.getItem("png_web_bg_color") || "white";
    applyBgColor(savedBgColor);

    document.querySelectorAll(".color-item").forEach(item => {
        item.addEventListener("click", () => {
            const key = item.getAttribute("data-key");
            localStorage.setItem("png_web_bg_color", key);
            applyBgColor(key);
        });
    });

    function applyBgColor(key) {
        document.querySelectorAll(".color-item").forEach(it => it.classList.remove("selected"));
        let target = document.querySelector(`.color-item[data-key="${key}"]`) || document.querySelector(`.color-item[data-key="white"]`);
        target.classList.add("selected");
        selectedBgColor = target.getAttribute("data-color");
        document.getElementById("txt-selected-color-name").textContent = target.getAttribute("data-name");
    }

    // 2.1 封面设置浮层：防吞开关（默认开）+ 保留元数据开关
    const btnCoverSettings = document.getElementById("btn-cover-settings");
    const coverSettingsPop = document.getElementById("cover-settings-pop");

    function toggleCoverSettings(open) {
        const willOpen = (typeof open === "boolean") ? open : coverSettingsPop.hidden;
        coverSettingsPop.hidden = !willOpen;
        btnCoverSettings.setAttribute("aria-expanded", String(willOpen));
    }

    btnCoverSettings.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleCoverSettings();
    });
    document.getElementById("btn-cover-settings-close").addEventListener("click", () => toggleCoverSettings(false));
    document.addEventListener("click", (e) => {
        if (!coverSettingsPop.hidden && !coverSettingsPop.contains(e.target) && !btnCoverSettings.contains(e.target)) {
            toggleCoverSettings(false);
        }
    });

    // 防吞「测试功能」说明弹窗
    const infoModal = document.getElementById("info-modal");
    document.getElementById("btn-anti-swallow-info").addEventListener("click", (e) => {
        e.stopPropagation();
        infoModal.hidden = false;
        toggleCoverSettings(false);
    });
    document.getElementById("btn-info-modal-close").addEventListener("click", () => { infoModal.hidden = true; });
    infoModal.addEventListener("click", (e) => { if (e.target === infoModal) infoModal.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !infoModal.hidden) infoModal.hidden = true; });

    // 保留原图元数据开关（默认去除，localStorage 持久化）
    const chkKeepMeta = document.getElementById("chk-keep-meta");
    chkKeepMeta.checked = localStorage.getItem("png_web_keep_meta") === "1";
    chkKeepMeta.addEventListener("change", () => {
        localStorage.setItem("png_web_keep_meta", chkKeepMeta.checked ? "1" : "0");
    });

    // 防吞开关（默认开启，localStorage 持久化）
    const chkAntiSwallow = document.getElementById("chk-anti-swallow");
    chkAntiSwallow.checked = localStorage.getItem("png_web_anti_swallow") !== "0";
    chkAntiSwallow.addEventListener("change", () => {
        localStorage.setItem("png_web_anti_swallow", chkAntiSwallow.checked ? "1" : "0");
    });
    // 3. 封面持久化加载
    const savedCoverDataUrl = localStorage.getItem("png_web_custom_cover");
    if (savedCoverDataUrl) {
        document.getElementById("img-cover-thumb").src = savedCoverDataUrl;
        document.getElementById("txt-cover-status").textContent = "自定义封面 [已持久保存]";
        fetch(savedCoverDataUrl).then(r => r.blob()).then(b => customCoverBlob = b);
    } else if (window.DEFAULT_COVER_DATA_URL) {
        // file:// 下内置封面若以本地路径加载会污染 canvas，统一改用内嵌 data URL。
        document.getElementById("img-cover-thumb").src = window.DEFAULT_COVER_DATA_URL;
    }

    // 更换封面
    document.getElementById("btn-pick-cover").addEventListener("click", () => {
        document.getElementById("input-custom-cover").click();
    });

    document.getElementById("input-custom-cover").addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            customCoverBlob = file;
            const url = URL.createObjectURL(file);
            document.getElementById("img-cover-thumb").src = url;
            document.getElementById("txt-cover-status").textContent = "自定义封面 [单次未保存]";
        }
    });

    // 保存封面
    document.getElementById("btn-save-cover").addEventListener("click", () => {
        if (!customCoverBlob) {
            alert("当前为内置默认封面，无需重复保存");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            localStorage.setItem("png_web_custom_cover", reader.result);
            document.getElementById("txt-cover-status").textContent = "自定义封面 [已持久保存]";
            alert("已成功保存当前封面，下次打开网页依然生效！");
        };
        reader.readAsDataURL(customCoverBlob);
    });

    // 恢复默认封面
    document.getElementById("btn-reset-cover").addEventListener("click", () => {
        customCoverBlob = null;
        localStorage.removeItem("png_web_custom_cover");
        document.getElementById("img-cover-thumb").src = window.DEFAULT_COVER_DATA_URL || "assets/default_cover.png";
        document.getElementById("txt-cover-status").textContent = "内置默认封面";
        alert("已恢复并保存为内置默认封面");
    });

    // 4. 选择要伪装的原图
    const boxSrc = document.getElementById("box-src-upload");
    const inputSrc = document.getElementById("input-src-images");
    boxSrc.addEventListener("click", () => inputSrc.click());
    enableDropUpload(boxSrc, inputSrc);

    inputSrc.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            srcFiles = Array.from(e.target.files);
            const first = srcFiles[0];
            const url = URL.createObjectURL(first);
            const preview = document.getElementById("img-src-preview");
            preview.src = url;
            preview.style.display = "block";
            boxSrc.querySelector(".upload-icon").style.display = "none";
            boxSrc.querySelector(".upload-text").style.display = "none";
            boxSrc.querySelector(".upload-hint").style.display = "none";

            const badge = document.getElementById("badge-src-info");
            badge.style.display = "block";
            if (srcFiles.length === 1) {
                badge.textContent = `已选: ${first.name} (${(first.size / 1024).toFixed(1)} KB)`;
            } else {
                badge.textContent = `已批量多选 ${srcFiles.length} 张图片，封面将自动绘制序号徽章`;
            }
            document.getElementById("card-disguise-result").style.display = "none";
        }
    });

    // 5. 立即执行伪装合成
    document.getElementById("btn-do-disguise").addEventListener("click", async () => {
        if (!srcFiles || srcFiles.length === 0) {
            alert("请先选择要伪装的图片");
            return;
        }

        const btn = document.getElementById("btn-do-disguise");
        btn.disabled = true;
        btn.textContent = "⏳ 正在本地合成伪装图片中...";

        try {
            lastDisguisedResults = [];
            const timeBase = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

            // 获取当前有效封面 Image 对象
            const coverImg = await loadImage(document.getElementById("img-cover-thumb").src);

            for (let i = 0; i < srcFiles.length; i++) {
                const file = srcFiles[i];
                const badgeNum = srcFiles.length > 1 ? (i + 1) : null;
                let keepMeta = false, metaChunks = [];
                try {
                    keepMeta = document.getElementById("chk-keep-meta").checked;
                    if (keepMeta) {
                        metaChunks = extractMetaChunks(new Uint8Array(await file.arrayBuffer()));
                    }
                } catch (e) { keepMeta = false; metaChunks = []; }
                const disguisedApngBlob = await disguiseSingleFile(file, coverImg, badgeNum, selectedBgColor, keepMeta, metaChunks);
                const filename = `${String(i + 1).padStart(3, "0")}_disguised_${timeBase}.png`;
                const url = URL.createObjectURL(disguisedApngBlob);
                lastDisguisedResults.push({ blob: disguisedApngBlob, filename, url });

                // 保存到 IndexedDB 历史（同一源文件去重）
                const srcFp = await fileFingerprint(file);
                saveToHistory("disguised", filename, disguisedApngBlob, url, srcFp);
            }

            // 展示首张结果
            const firstRes = lastDisguisedResults[0];
            document.getElementById("card-disguise-result").style.display = "block";
            document.getElementById("img-result-cover").src = document.getElementById("img-cover-thumb").src;
            document.getElementById("img-result-real").src = URL.createObjectURL(srcFiles[0]);

            const summary = document.getElementById("txt-disguise-summary");
            if (lastDisguisedResults.length === 1) {
                document.getElementById("txt-disguise-title").textContent = "🎉 伪装生成成功 (双重视角预览)";
                summary.textContent = `单张伪装完成！格式: APNG (.png) | 大小: ${(firstRes.blob.size / 1024).toFixed(1)} KB`;
            } else {
                document.getElementById("txt-disguise-title").textContent = `🎉 批量伪装完成 (共 ${lastDisguisedResults.length} 张，带序号)`;
                summary.textContent = `成功生成 ${lastDisguisedResults.length} 张 APNG 伪装图片，可一键全部下载或对外分享！`;
            }
        } catch (err) {
            alert("伪装生成失败: " + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "⚡ 立即生成 APNG 伪装图片";
        }
    });

    // 伪装单张文件为 APNG
    async function disguiseSingleFile(file, coverImg, badgeNum, bgColor, keepMeta, metaChunks) {
        const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");

        if (isGif) {
            // 解析 GIF 全部帧
            const fileBuf = new Uint8Array(await file.arrayBuffer());
            const reader = new GifReader(fileBuf);
            if (!reader.frames || reader.frames.length === 0) {
                throw new Error("GIF 动图帧解析为空");
            }

            const w = reader.width;
            const h = reader.height;
            const frameCount = reader.frames.length;

            // 生成等尺寸底色封面图 Canvas
            const coverCanvas = document.createElement("canvas");
            coverCanvas.width = w;
            coverCanvas.height = h;
            const cctx = coverCanvas.getContext("2d");
            cctx.fillStyle = bgColor;
            cctx.fillRect(0, 0, w, h);

            const scale = Math.min(w / coverImg.width, h / coverImg.height);
            const dw = Math.max(1, Math.round(coverImg.width * scale));
            const dh = Math.max(1, Math.round(coverImg.height * scale));
            const dx = Math.round((w - dw) / 2);
            const dy = Math.round((h - dh) / 2);
            cctx.drawImage(coverImg, dx, dy, dw, dh);

            // 绘制序号徽章
            if (badgeNum) {
                drawBadgeOnCanvas(cctx, w, h, badgeNum);
            }

            // 隐蔽防吞：仅扰动封面，真图帧不受影响（可在「封面设置」中关闭）
            if (document.getElementById("chk-anti-swallow").checked) antiSwallowNoise(coverCanvas);

            const coverPngBlob = await elementToPngBlob(coverCanvas);
            const coverBuf = new Uint8Array(await coverPngBlob.arrayBuffer());
            const coverChunks = ApngCodec.parseChunks(coverBuf);
            const coverIdats = coverChunks.filter(c => c.type === "IDAT").map(c => c.payload);

            let parts = [
                ApngCodec.PNG_SIG,
                ApngCodec.chunkBytes("IHDR", coverChunks.find(c => c.type === "IHDR").payload)
            ];

            // acTL (frameCount, playCount 0)
            let actl = new Uint8Array(8);
            new DataView(actl.buffer).setUint32(0, frameCount, false);
            new DataView(actl.buffer).setUint32(4, 0, false);
            parts.push(ApngCodec.chunkBytes("acTL", actl));

            // tEXt marker: ANIMATED
            let keyBytes = new TextEncoder().encode("ChatBarApngDisguise");
            let valBytes = new TextEncoder().encode(`1;ANIMATED;${frameCount}`);
            let textPayload = new Uint8Array(keyBytes.length + 1 + valBytes.length);
            textPayload.set(keyBytes, 0);
            textPayload[keyBytes.length] = 0;
            textPayload.set(valBytes, keyBytes.length + 1);
            parts.push(ApngCodec.chunkBytes("tEXt", textPayload));

            // Default frame (cover)
            for (let p of coverIdats) {
                parts.push(ApngCodec.chunkBytes("IDAT", p));
            }

            let seq = 0;
            for (let i = 0; i < frameCount; i++) {
                const fr = reader.frames[i];
                const frPngBlob = await elementToPngBlob(fr.canvas);
                const frBuf = new Uint8Array(await frPngBlob.arrayBuffer());
                const frChunks = ApngCodec.parseChunks(frBuf);
                const frIdats = frChunks.filter(c => c.type === "IDAT").map(c => c.payload);

                let delayMs = fr.delay || 100;
                let delayNum = Math.max(1, Math.round(delayMs / 10));

                let fctl = new Uint8Array(26);
                let vf = new DataView(fctl.buffer);
                vf.setUint32(0, seq++, false);
                vf.setUint32(4, w, false);
                vf.setUint32(8, h, false);
                vf.setUint32(12, 0, false);
                vf.setUint32(16, 0, false);
                vf.setUint16(20, delayNum, false);
                vf.setUint16(22, 100, false);
                vf.setUint8(24, 0);
                vf.setUint8(25, 0);
                parts.push(ApngCodec.chunkBytes("fcTL", fctl));

                for (let p of frIdats) {
                    let fdat = new Uint8Array(4 + p.length);
                    new DataView(fdat.buffer).setUint32(0, seq++, false);
                    fdat.set(p, 4);
                    parts.push(ApngCodec.chunkBytes("fdAT", fdat));
                }
            }

            parts.push(ApngCodec.chunkBytes("IEND", new Uint8Array(0)));
            let finalBytes = ApngCodec.concatBuffers(parts);
            if (keepMeta && metaChunks && metaChunks.length) finalBytes = appendMetaChunks(finalBytes, metaChunks);
            return new Blob([finalBytes], { type: "image/png" });
        }

        // 静态图片处理
        const srcImg = await loadImage(URL.createObjectURL(file));
        const w = srcImg.width;
        const h = srcImg.height;

        const coverCanvas = document.createElement("canvas");
        coverCanvas.width = w;
        coverCanvas.height = h;
        const cctx = coverCanvas.getContext("2d");
        cctx.fillStyle = bgColor;
        cctx.fillRect(0, 0, w, h);

        const scale = Math.min(w / coverImg.width, h / coverImg.height);
        const dw = Math.max(1, Math.round(coverImg.width * scale));
        const dh = Math.max(1, Math.round(coverImg.height * scale));
        const dx = Math.round((w - dw) / 2);
        const dy = Math.round((h - dh) / 2);
        cctx.drawImage(coverImg, dx, dy, dw, dh);

        if (badgeNum) {
            drawBadgeOnCanvas(cctx, w, h, badgeNum);
        }

        // 隐蔽防吞：仅扰动封面，真图帧不受影响（可在「封面设置」中关闭）
        if (document.getElementById("chk-anti-swallow").checked) antiSwallowNoise(coverCanvas);

        const coverPngBlob = await elementToPngBlob(coverCanvas);
        const coverBuf = new Uint8Array(await coverPngBlob.arrayBuffer());
        const coverChunks = ApngCodec.parseChunks(coverBuf);
        const coverIdats = coverChunks.filter(c => c.type === "IDAT").map(c => c.payload);

        const srcPngBlob = await elementToPngBlob(srcImg);
        const srcBuf = new Uint8Array(await srcPngBlob.arrayBuffer());
        const srcChunks = ApngCodec.parseChunks(srcBuf);
        const srcIdats = srcChunks.filter(c => c.type === "IDAT").map(c => c.payload);

        let parts = [
            ApngCodec.PNG_SIG,
            ApngCodec.chunkBytes("IHDR", coverChunks.find(c => c.type === "IHDR").payload)
        ];

        let actl = new Uint8Array(8);
        new DataView(actl.buffer).setUint32(0, 2, false);
        new DataView(actl.buffer).setUint32(4, 0, false);
        parts.push(ApngCodec.chunkBytes("acTL", actl));

        let keyBytes = new TextEncoder().encode("ChatBarApngDisguise");
        let valBytes = new TextEncoder().encode("1;STATIC;1");
        let textPayload = new Uint8Array(keyBytes.length + 1 + valBytes.length);
        textPayload.set(keyBytes, 0);
        textPayload[keyBytes.length] = 0;
        textPayload.set(valBytes, keyBytes.length + 1);
        parts.push(ApngCodec.chunkBytes("tEXt", textPayload));

        for (let p of coverIdats) {
            parts.push(ApngCodec.chunkBytes("IDAT", p));
        }

        let seq = 0;
        let fctl1 = new Uint8Array(26);
        let vf1 = new DataView(fctl1.buffer);
        vf1.setUint32(0, seq++, false);
        vf1.setUint32(4, w, false);
        vf1.setUint32(8, h, false);
        vf1.setUint32(12, 0, false);
        vf1.setUint32(16, 0, false);
        vf1.setUint16(20, 10, false);
        vf1.setUint16(22, 100, false);
        vf1.setUint8(24, 0);
        vf1.setUint8(25, 0);
        parts.push(ApngCodec.chunkBytes("fcTL", fctl1));

        for (let p of srcIdats) {
            let fdat = new Uint8Array(4 + p.length);
            new DataView(fdat.buffer).setUint32(0, seq++, false);
            fdat.set(p, 4);
            parts.push(ApngCodec.chunkBytes("fdAT", fdat));
        }

        // 心跳保活帧
        let fctl2 = new Uint8Array(26);
        let vf2 = new DataView(fctl2.buffer);
        vf2.setUint32(0, seq++, false);
        vf2.setUint32(4, 1, false);
        vf2.setUint32(8, 1, false);
        vf2.setUint32(12, 0, false);
        vf2.setUint32(16, 0, false);
        vf2.setUint16(20, 10, false);
        vf2.setUint16(22, 100, false);
        vf2.setUint8(24, 0);
        vf2.setUint8(25, 1);
        parts.push(ApngCodec.chunkBytes("fcTL", fctl2));

        let hbCanvas = document.createElement("canvas");
        hbCanvas.width = 1; hbCanvas.height = 1;
        let hbBlob = await elementToPngBlob(hbCanvas);
        let hbBuf = new Uint8Array(await hbBlob.arrayBuffer());
        let hbIdat = ApngCodec.parseChunks(hbBuf).find(c => c.type === "IDAT").payload;
        let hbFdat = new Uint8Array(4 + hbIdat.length);
        new DataView(hbFdat.buffer).setUint32(0, seq++, false);
        hbFdat.set(hbIdat, 4);
        parts.push(ApngCodec.chunkBytes("fdAT", hbFdat));

        parts.push(ApngCodec.chunkBytes("IEND", new Uint8Array(0)));
        let finalBytes = ApngCodec.concatBuffers(parts);
        if (keepMeta && metaChunks && metaChunks.length) finalBytes = appendMetaChunks(finalBytes, metaChunks);
        return new Blob([finalBytes], { type: "image/png" });
    }
    // ===== 元数据 / NovelAI 提示词信息处理 =====
    // 从源文件字节中提取可保留的元数据块（PNG 的 tEXt/iTXt/zTXt/eXIf；JPEG 的 APP1 Exif 转 eXIf）
    function extractMetaChunks(raw) {
        const out = [];
        try {
            if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4E && raw[3] === 0x47) {
                const chunks = ApngCodec.parseChunks(raw);
                for (const c of chunks) {
                    if (["tEXt", "iTXt", "zTXt", "eXIf"].includes(c.type)) {
                        out.push({ type: c.type, payload: c.payload });
                    }
                }
            } else if (raw[0] === 0xFF && raw[1] === 0xD8) {
                let pos = 2;
                while (pos + 4 <= raw.length) {
                    const marker0 = raw[pos], marker1 = raw[pos + 1];
                    const len = (raw[pos + 2] << 8) | raw[pos + 3];
                    const segEnd = pos + 2 + len;
                    if (marker0 === 0xFF && marker1 === 0xE1 && len >= 6 &&
                        raw[pos + 4] === 0x45 && raw[pos + 5] === 0x78 &&
                        raw[pos + 6] === 0x69 && raw[pos + 7] === 0x66) {
                        // APP1 段内容（以 "Exif\0\0" 开头）整体转存为 PNG eXIf 块
                        out.push({ type: "eXIf", payload: raw.slice(pos + 4, segEnd) });
                        break;
                    }
                    if (marker0 === 0xFF && marker1 === 0xDA) break;   // 到达图像数据
                    if (len <= 0) break;
                    pos = segEnd;
                }
            }
        } catch (e) { /* 提取失败不影响主流程 */ }
        return out;
    }

    // 显式清理像素 alpha 最低位（NovelAI 提示词隐写位），全透明像素 RGB 归白。
    // 返回是否发生了改动。
    function stripAlphaLSB(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        let changed = false;
        for (let i = 0; i < px.length; i += 4) {
            const a = px[i + 3];
            const na = a & 0xFE;
            if (na !== a) { px[i + 3] = na; changed = true; }
            if (na === 0 && (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255)) {
                px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; changed = true;
            }
        }
        if (changed) ctx.putImageData(img, 0, 0);
        return changed;
    }

    // 在 PNG 字节中追加元数据块（插到 IEND 之前）
    function appendMetaChunks(pngBytes, metaChunks) {
        if (!metaChunks || metaChunks.length === 0) return pngBytes;
        const chunks = ApngCodec.parseChunks(pngBytes);
        const iendIdx = chunks.findIndex(c => c.type === "IEND");
        const body = iendIdx >= 0 ? chunks.slice(0, iendIdx) : chunks;
        const parts = [ApngCodec.PNG_SIG];
        for (const c of body) {
            parts.push(ApngCodec.chunkBytes(c.type, c.payload));
        }
        for (const mc of metaChunks) {
            parts.push(ApngCodec.chunkBytes(mc.type, mc.payload));
        }
        parts.push(ApngCodec.chunkBytes("IEND", new Uint8Array(0)));
        return ApngCodec.concatBuffers(parts);
    }


    function drawBadgeOnCanvas(cctx, w, h, badgeNum) {
        const density = Math.max(1, Math.min(w, h) / 400);
        const size = Math.round(28 * density);
        cctx.font = `bold ${size}px sans-serif`;
        const text = String(badgeNum);
        const m = cctx.measureText(text);
        const pad = 12 * density;
        const bw = m.width + pad * 2;
        const bh = size + pad * 1.5;
        const margin = 16 * density;

        cctx.fillStyle = "rgba(0,0,0,0.78)";
        cctx.beginPath();
        cctx.roundRect(margin, margin, bw, bh, 8 * density);
        cctx.fill();

        cctx.fillStyle = "#FFFFFF";
        cctx.fillText(text, margin + pad, margin + pad + size * 0.85);
    }
    // 隐蔽防吞：对封面画布施加极轻微、每次随机的像素扰动。
    // 目的：让平台在缩略图/hash 层面把每次生成的封面判为"不同图"，避免被去重吞图。
    // 说明：只作用于封面画布，绝不触碰真实内容帧，因此还原出的真图零改动。
    function antiSwallowNoise(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const w = canvas.width, h = canvas.height;
        if (!w || !h) return canvas;
        const img = ctx.getImageData(0, 0, w, h);
        const px = img.data;

        // 1) 全图随机轻微通道扰动：±2 级，肉眼几乎不可辨，但会改变缩略图指纹。
        //    用整数运算避免 Math.random 逐像素调用的性能开销。
        let seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
        const rnd = () => {
            seed ^= seed << 13; seed >>>= 0;
            seed ^= seed >>> 17;
            seed ^= seed << 5;  seed >>>= 0;
            return seed;
        };
        // 幅度：每个通道 ±2（钳制在 0~255，绝不环绕翻转）。
        const AMP = 2;
        const jitter = () => (rnd() % (2 * AMP + 1)) - AMP;   // -AMP ~ +AMP
        for (let i = 0; i < px.length; i += 4) {
            // 仅扰动 RGB；alpha 保持不动，避免影响透明区域语义。
            px[i]     = Math.min(255, Math.max(0, px[i]     + jitter()));
            px[i + 1] = Math.min(255, Math.max(0, px[i + 1] + jitter()));
            px[i + 2] = Math.min(255, Math.max(0, px[i + 2] + jitter()));
        }

        // 2) 叠加一个每次随机的整体色偏 Δ（每通道 -1~1），比纯噪声更抗二次压缩
        const dR = (rnd() % 3) - 1;
        const dG = (rnd() % 3) - 1;
        const dB = (rnd() % 3) - 1;
        if (dR || dG || dB) {
            for (let i = 0; i < px.length; i += 4) {
                px[i]     = Math.min(255, Math.max(0, px[i] + dR));
                px[i + 1] = Math.min(255, Math.max(0, px[i + 1] + dG));
                px[i + 2] = Math.min(255, Math.max(0, px[i + 2] + dB));
            }
        }

        ctx.putImageData(img, 0, 0);
        return canvas;
    }

    // 6. 还原功能
    const boxRestore = document.getElementById("box-restore-upload");
    const inputRestore = document.getElementById("input-restore-images");
    boxRestore.addEventListener("click", () => inputRestore.click());
    enableDropUpload(boxRestore, inputRestore);

    inputRestore.addEventListener("change", async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            restoreFiles = Array.from(e.target.files);
            const first = restoreFiles[0];
            const url = URL.createObjectURL(first);
            const preview = document.getElementById("img-restore-src-preview");
            preview.src = url;
            preview.style.display = "block";
            boxRestore.querySelector(".upload-icon").style.display = "none";
            boxRestore.querySelector(".upload-text").style.display = "none";
            boxRestore.querySelector(".upload-hint").style.display = "none";

            const badge = document.getElementById("badge-restore-info");
            badge.style.display = "block";

            // 检测首张
            const buf = new Uint8Array(await first.arrayBuffer());
            const info = ApngCodec.inspectDisguise(buf);
            if (info) {
                const groups = ApngCodec.extractFrameGroups(info.chunks);
                const realFrameCount = ApngCodec.countHiddenFrames(groups);
                const isAnim = info.meta.kind === "ANIMATED" || realFrameCount >= 2;
                let kindStr;
                if (info.meta.kind === "ANIMATED" || isAnim) {
                    kindStr = "动态隐写";
                } else if (info.meta.kind === "STATIC") {
                    kindStr = "静态隐写";
                } else {
                    kindStr = "标准隐藏帧";
                }
                badge.textContent = `✔ 识别为伪装 APNG (${kindStr}, 隐藏${realFrameCount}帧, 尺寸 ${info.width}x${info.height}, 将还原为 ${isAnim ? "GIF 动图" : "PNG 图片"})`;
                badge.style.color = "#059669";
            } else {
                badge.textContent = `已选 ${restoreFiles.length} 个文件准备提取`;
                badge.style.color = "#475569";
            }
            document.getElementById("card-restore-result").style.display = "none";
        }
    });

    document.getElementById("btn-do-restore").addEventListener("click", async () => {
        if (!restoreFiles || restoreFiles.length === 0) {
            alert("请先选择收到的伪装图片文件");
            return;
        }

        const btn = document.getElementById("btn-do-restore");
        btn.disabled = true;
        btn.textContent = "⏳ 正在提取还原中...";

        try {
            lastRestoredResults = [];
            const timeBase = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

            for (let i = 0; i < restoreFiles.length; i++) {
                const file = restoreFiles[i];
                const buf = new Uint8Array(await file.arrayBuffer());
                const info = ApngCodec.inspectDisguise(buf);
                if (!info) continue;

                const groups = ApngCodec.extractFrameGroups(info.chunks);
                if (groups.length === 0) continue;

                const ihdr = info.chunks.find(c => c.type === "IHDR").payload;
                const realFrameCount = ApngCodec.countHiddenFrames(groups);
                const isAnim = info.meta.kind === "ANIMATED" || realFrameCount >= 2;

                let restoredBlob = null;
                let format = "png";

                if (isAnim) {
                    // 合成标准 GIF
                    const gifEncoder = new WebGIFEncoder();
                    gifEncoder.start();
                    gifEncoder.setRepeat(0);

                    for (let g of groups) {
                        const framePngBytes = ApngCodec.frameGroupToPng(ihdr, g);
                        const frameImg = await loadImage(URL.createObjectURL(new Blob([framePngBytes], { type: "image/png" })));
                        
                        let delayMs = 100;
                        if (g.fcTL && g.fcTL.length >= 26) {
                            let vf = new DataView(g.fcTL.buffer, g.fcTL.byteOffset, g.fcTL.byteLength);
                            let dNum = vf.getUint16(20, false);
                            let dDen = vf.getUint16(22, false);
                            if (dDen === 0) dDen = 100;
                            if (dNum === 0) dNum = 10;
                            delayMs = Math.round((dNum * 1000) / dDen);
                            if (delayMs < 10) delayMs = 20;
                        }

                        const canvas = document.createElement("canvas");
                        canvas.width = frameImg.width;
                        canvas.height = frameImg.height;
                        const ctx = canvas.getContext("2d");
                        ctx.drawImage(frameImg, 0, 0);
                        const imgData = ctx.getImageData(0, 0, frameImg.width, frameImg.height);
                        gifEncoder.addFrame(imgData, delayMs);
                    }
                    const gifBytes = gifEncoder.finish();
                    restoredBlob = new Blob([gifBytes], { type: "image/gif" });
                    format = "gif";
                } else {
                    // 单帧 PNG
                    const pngBytes = ApngCodec.frameGroupToPng(ihdr, groups[0]);
                    restoredBlob = new Blob([pngBytes], { type: "image/png" });
                    format = "png";
                }

                const filename = `${String(i + 1).padStart(3, "0")}_restored_${timeBase}.${format}`;
                const url = URL.createObjectURL(restoredBlob);

                // 顺带取回这张伪装图自身的封面（APNG 默认帧）
                let coverBlob = null;
                let coverUrl = null;
                try {
                    const coverPngBytes = ApngCodec.extractDefaultFramePng(info.chunks);
                    if (coverPngBytes) {
                        coverBlob = new Blob([coverPngBytes], { type: "image/png" });
                        coverUrl = URL.createObjectURL(coverBlob);
                    }
                } catch (e) {
                    coverBlob = null;
                    coverUrl = null;
                }

                lastRestoredResults.push({ blob: restoredBlob, filename, url, format, coverBlob, coverUrl, coverName: file.name });

                const srcFp = await fileFingerprint(file);
                saveToHistory("restored", filename, restoredBlob, url, srcFp);
            }

            if (lastRestoredResults.length === 0) {
                alert("未能从所选文件中解析出有效隐藏图片");
                return;
            }

            const firstRes = lastRestoredResults[0];
            document.getElementById("card-restore-result").style.display = "block";
            document.getElementById("img-restored-preview").src = firstRes.url;

            // 伪装封面栏
            const coverSection = document.getElementById("restore-cover-section");
            const coverImg = document.getElementById("img-restore-cover");
            if (firstRes.coverUrl) {
                coverImg.src = firstRes.coverUrl;
                coverSection.style.display = "block";
            } else {
                coverImg.removeAttribute("src");
                coverSection.style.display = "none";
            }


            const summary = document.getElementById("txt-restore-summary");
            if (lastRestoredResults.length === 1) {
                document.getElementById("txt-restore-title").textContent = "✨ 成功提取还原真实图片";
                summary.textContent = `还原成功！格式: ${firstRes.format.toUpperCase()} | 大小: ${(firstRes.blob.size / 1024).toFixed(1)} KB`;
            } else {
                document.getElementById("txt-restore-title").textContent = `✨ 批量还原完成 (成功提取 ${lastRestoredResults.length} 张)`;
                summary.textContent = `共成功提取 ${lastRestoredResults.length} 张真实图片/动图，可全部下载到本地！`;
            }
        } catch (err) {
            alert("还原失败: " + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "🔍 立即还原真实图片 / 动图";
        }
    });

    // 6.5 拆解动图功能
    const boxSplit = document.getElementById("box-split-upload");
    const inputSplit = document.getElementById("input-split-images");
    boxSplit.addEventListener("click", () => inputSplit.click());
    enableDropUpload(boxSplit, inputSplit);

    inputSplit.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
            splitFiles = Array.from(e.target.files);
            const first = splitFiles[0];
            const url = URL.createObjectURL(first);
            const preview = document.getElementById("img-split-src-preview");
            preview.src = url;
            preview.style.display = "block";
            boxSplit.querySelector(".upload-icon").style.display = "none";
            boxSplit.querySelector(".upload-text").style.display = "none";
            boxSplit.querySelector(".upload-hint").style.display = "none";

            const badge = document.getElementById("badge-split-info");
            badge.style.display = "block";
            badge.textContent = `已选 ${splitFiles.length} 个 GIF 动图准备拆解`;
            badge.style.color = "#475569";
            document.getElementById("card-split-result").style.display = "none";
        }
    });

    document.getElementById("btn-do-split").addEventListener("click", async () => {
        if (!splitFiles || splitFiles.length === 0) {
            alert("请先选择要拆解的 GIF 动图");
            return;
        }

        const btn = document.getElementById("btn-do-split");
        btn.disabled = true;
        btn.textContent = "⏳ 正在拆解动图中...";

        try {
            lastSplitResults = [];
            const timeBase = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

            for (let i = 0; i < splitFiles.length; i++) {
                const file = splitFiles[i];
                const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
                if (!isGif) continue;

                const fileBuf = new Uint8Array(await file.arrayBuffer());
                const reader = new GifReader(fileBuf);
                if (!reader.frames || reader.frames.length === 0) {
                    throw new Error(`未从 ${file.name} 解析出任何帧`);
                }

                const baseName = file.name.replace(/\.gif$/i, "");
                for (let f = 0; f < reader.frames.length; f++) {
                    const frame = reader.frames[f];
                    const frameBlob = await elementToPngBlob(frame.canvas);
                    const filename = `${String(i + 1).padStart(3, "0")}_${baseName}_frame_${String(f + 1).padStart(3, "0")}.png`;
                    const frameUrl = URL.createObjectURL(frameBlob);
                    lastSplitResults.push({ blob: frameBlob, filename, url: frameUrl });
                }
            }

            if (lastSplitResults.length === 0) {
                alert("未能从所选文件中解析出有效动图帧");
                return;
            }

            const grid = document.getElementById("split-frame-grid");
            grid.innerHTML = "";
            lastSplitResults.forEach((item) => {
                const el = document.createElement("div");
                el.className = "split-frame-item";
                el.innerHTML = `<img src="${item.url}" alt="frame" class="zoomable"><div class="split-frame-label">${item.filename}</div>`;
                el.querySelector("img").addEventListener("click", () => {
                    const list = lastSplitResults
                        .filter(r => r && r.url)
                        .map(r => ({ url: r.url, label: r.filename || "" }));
                    const idx = list.findIndex(it => it.url === item.url);
                    showModal(list, idx >= 0 ? idx : 0);
                });
                grid.appendChild(el);
            });

            document.getElementById("card-split-result").style.display = "block";
            document.getElementById("txt-split-title").textContent = `✂️ 动图拆解完成 (共 ${lastSplitResults.length} 帧)`;
            document.getElementById("txt-split-summary").textContent = `成功拆解 ${splitFiles.length} 个 GIF 动图，共提取 ${lastSplitResults.length} 张 PNG 帧图片`;
        } catch (err) {
            alert("拆解失败: " + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "✂️ 立即拆解 GIF 动图";
        }
    });

    document.getElementById("btn-download-split").addEventListener("click", () => downloadAll(lastSplitResults));

    // 6.6 图片混沌功能
    const boxChaos = document.getElementById("box-chaos-upload");
    const inputChaos = document.getElementById("input-chaos-image");
    let chaosSourceCanvas = null;   // 当前原图（已按尺寸限制规范化）
    let chaosResultBlob = null;
    let chaosResultUrl = null;
    let chaosMode = "enc";
    let chaosNoScale = false;   // 是否按原图尺寸处理（不缩小）
    let chaosBatchMode = false; // 多图批量模式开关
    let chaosBatchFiles = [];   // 多图模式下已选文件列表
    let chaosBatchResults = []; // 多图批量处理结果 {blob, filename, url, name}

    // 图片 → 规范化 canvas（按"不缩小"开关决定是否压缩尺寸），失败抛错
    async function chaosFileToCanvas(file) {
        const img = await loadImage(URL.createObjectURL(file));
        if (chaosNoScale) {
            const w0 = img.naturalWidth || img.width;
            const h0 = img.naturalHeight || img.height;
            if (!w0 || !h0) throw new Error("图片尺寸无效");
            const c = document.createElement("canvas");
            c.width = w0;
            c.height = h0;
            c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w0, h0);
            return c;
        }
        return ImageChaos.toCanvas(img);
    }

    const chkChaosNoScale = document.getElementById("chk-chaos-noscale");
    chkChaosNoScale.addEventListener("change", () => {
        if (chkChaosNoScale.checked) {
            const ok = confirm(
                "不缩小（按原图尺寸处理）提示：\n\n"
                + "• 超大图会占用大量内存，处理过程中浏览器可能卡顿，甚至因内存不足而崩溃；\n"
                + "• 手机端或内存较小的设备风险更高，可能导致页面被迫刷新、处理结果丢失；\n"
                + "• 若你的图片非常大，建议保持默认（自动等比缩小）以获得更稳定的体验。\n\n"
                + "确定要继续启用“不缩小”吗？"
            );
            if (!ok) { chkChaosNoScale.checked = false; chaosNoScale = false; return; }
            chaosNoScale = true;
        } else {
            chaosNoScale = false;
        }
    });

    boxChaos.addEventListener("click", () => inputChaos.click());
    enableDropUpload(boxChaos, inputChaos);

    // 单图 / 多图模式切换
    function applyChaosModeUI() {
        const btn = document.getElementById("btn-chaos-mode");
        const uploadText = boxChaos.querySelector(".upload-text");
        const uploadHint = boxChaos.querySelector(".upload-hint");
        btn.textContent = chaosBatchMode ? "切换单图模式" : "切换多图模式";
        // 多图模式没有"单一原图"概念，隐藏单图预览框与"还原为原图"按钮
        document.getElementById("chaos-single-preview-row").style.display = chaosBatchMode ? "none" : "";
        document.getElementById("btn-chaos-reset").style.display = chaosBatchMode ? "none" : "";
        if (!chaosBatchMode) {
            document.getElementById("card-chaos-batch").style.display = "none";
            uploadText.textContent = "点击或拖拽图片到这里";
            uploadHint.textContent = "处理全程在本地浏览器完成，不上传任何服务器";
        } else {
            uploadText.textContent = "点击或拖拽图片到这里 (可多选)";
            uploadHint.textContent = "一次选多张，统一混淆或统一解混淆";
        }
    }

    function resetChaosUploadBox() {
        const preview = document.getElementById("img-chaos-preview");
        preview.removeAttribute("src");
        preview.style.display = "none";
        boxChaos.querySelector(".upload-icon").style.display = "";
        boxChaos.querySelector(".upload-text").style.display = "";
        boxChaos.querySelector(".upload-hint").style.display = "";
        const badge = document.getElementById("badge-chaos-info");
        badge.style.display = "none";
        badge.textContent = "";
    }

    function clearChaosBatchResults() {
        chaosBatchResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
        chaosBatchResults = [];
        document.getElementById("chaos-batch-grid").innerHTML = "";
        document.getElementById("txt-chaos-batch-summary").textContent = "";
        document.getElementById("card-chaos-batch").style.display = "none";
    }

    document.getElementById("btn-chaos-mode").addEventListener("click", () => {
        chaosBatchMode = !chaosBatchMode;
        chaosSourceCanvas = null;
        chaosBatchFiles = [];
        clearChaosResult();
        clearChaosBatchResults();
        resetChaosUploadBox();
        // 切换 multiple 属性并清空已选，避免上一种模式的残留文件
        if (chaosBatchMode) inputChaos.setAttribute("multiple", "");
        else inputChaos.removeAttribute("multiple");
        inputChaos.value = "";
        applyChaosModeUI();
    });
    applyChaosModeUI();

    inputChaos.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;

        // 多图批量模式：只记录文件，处理时统一转 canvas；重新选图会清空旧结果
        if (chaosBatchMode) {
            chaosBatchFiles = Array.from(e.target.files);
            clearChaosBatchResults();
            const preview = document.getElementById("img-chaos-preview");
            preview.src = URL.createObjectURL(chaosBatchFiles[0]);
            preview.style.display = "block";
            boxChaos.querySelector(".upload-icon").style.display = "none";
            boxChaos.querySelector(".upload-text").style.display = "none";
            boxChaos.querySelector(".upload-hint").style.display = "none";
            const badge = document.getElementById("badge-chaos-info");
            badge.style.display = "block";
            badge.style.color = "";
            badge.textContent = chaosBatchFiles.length === 1
                ? `已选: ${chaosBatchFiles[0].name}`
                : `已批量多选 ${chaosBatchFiles.length} 张图片`;
            return;
        }

        const file = e.target.files[0];
        const preview = document.getElementById("img-chaos-preview");

        try {
            chaosSourceCanvas = await chaosFileToCanvas(file);

            const srcUrl = chaosSourceCanvas.toDataURL("image/jpeg", 0.95);
            preview.src = srcUrl;
            preview.style.display = "block";
            boxChaos.querySelector(".upload-icon").style.display = "none";
            boxChaos.querySelector(".upload-text").style.display = "none";
            boxChaos.querySelector(".upload-hint").style.display = "none";

            clearChaosResult();

            const badge = document.getElementById("badge-chaos-info");
            badge.style.display = "block";
            badge.textContent = `已选: ${file.name} (${chaosSourceCanvas.width}x${chaosSourceCanvas.height})`;
            badge.style.color = "";
        } catch (err) {
            alert("图片加载失败: " + err.message);
        }
    });

    function clearChaosResult() {
        if (chaosResultUrl) {
            URL.revokeObjectURL(chaosResultUrl);
            chaosResultUrl = null;
        }
        chaosResultBlob = null;
        const outImgEl = document.getElementById("img-chaos-out");
        outImgEl.removeAttribute("src");
        outImgEl.hidden = true;
        document.getElementById("chaos-empty-out").hidden = false;
        document.getElementById("chaos-result-actions").style.display = "none";
        document.getElementById("txt-chaos-summary").textContent = "";
    }

    document.querySelectorAll("#chaos-mode-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#chaos-mode-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            chaosMode = btn.getAttribute("data-mode");
        });
    });

    function runChaos(canvas) {
        return ImageChaos.transform(canvas, chaosMode);
    }

    function refreshChaosActionState() {
        const label = chaosMode === "enc" ? "混淆" : "解混淆";
        document.getElementById("btn-chaos-run").textContent = `🌀 立即${label}`;
    }

    document.getElementById("btn-chaos-run").addEventListener("click", () => {
        // 多图批量模式：逐张转 canvas → 统一混淆/解混淆 → 网格展示
        if (chaosBatchMode) {
            if (!chaosBatchFiles || chaosBatchFiles.length === 0) {
                alert("请先选择要处理的图片");
                return;
            }
            runChaosBatch();
            return;
        }

        if (!chaosSourceCanvas) {
            alert("请先选择一张图片");
            return;
        }

        const btn = document.getElementById("btn-chaos-run");
        btn.disabled = true;
        const label = chaosMode === "enc" ? "混淆" : "解混淆";
        btn.textContent = `⏳ 正在${label}中...`;

        setTimeout(() => {
            try {
                const resultCanvas = runChaos(chaosSourceCanvas);
                resultCanvas.toBlob(blob => {
                    if (!blob) throw new Error("导出结果失败");

                    if (chaosResultUrl) URL.revokeObjectURL(chaosResultUrl);
                    chaosResultBlob = blob;
                    chaosResultUrl = URL.createObjectURL(blob);

                    const outEl = document.getElementById("img-chaos-out");
                    outEl.src = chaosResultUrl;
                    outEl.hidden = false;
                    document.getElementById("chaos-empty-out").hidden = true;
                    document.getElementById("txt-chaos-label-out").textContent =
                        chaosMode === "enc" ? "混淆结果" : "解混淆结果";
                    document.getElementById("chaos-result-actions").style.display = "flex";
                    document.getElementById("txt-chaos-summary").textContent =
                        `${label}完成 | 尺寸 ${resultCanvas.width}x${resultCanvas.height} | 大小 ${(blob.size / 1024).toFixed(1)} KB`;

                    btn.disabled = false;
                    refreshChaosActionState();
                }, "image/jpeg", 0.95);
            } catch (err) {
                alert(`${label}失败: ` + err.message);
                btn.disabled = false;
                refreshChaosActionState();
            }
        }, 30);
    });

    document.getElementById("btn-chaos-reset").addEventListener("click", () => {
        if (!chaosSourceCanvas) {
            alert("请先选择一张图片");
            return;
        }
        clearChaosResult();
        const resetOut = document.getElementById("img-chaos-out");
        resetOut.src = chaosSourceCanvas.toDataURL("image/jpeg", 0.95);
        resetOut.hidden = false;
        document.getElementById("chaos-empty-out").hidden = true;
        document.getElementById("txt-chaos-label-out").textContent = "原图（已还原）";
        alert("已把处理结果恢复为原图（未改动磁盘上的图片）");
    });

    document.getElementById("btn-chaos-download").addEventListener("click", () => {
        if (!chaosResultBlob) return;
        const a = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        a.href = chaosResultUrl;
        a.download = `chaos_${stamp}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // 点击解混淆 / 混淆结果可查看大图（支持缩放）
    document.getElementById("img-chaos-out").addEventListener("click", () => {
        const el = document.getElementById("img-chaos-out");
        if (el && el.getAttribute("src") && !el.hidden) {
            showModal(el.src);
        }
    });
    refreshChaosActionState();

    // 多图批量处理：逐张加载 → 混淆/解混淆 → 打包结果网格
    async function runChaosBatch() {
        const btn = document.getElementById("btn-chaos-run");
        const label = chaosMode === "enc" ? "混淆" : "解混淆";
        btn.disabled = true;
        btn.textContent = `⏳ 正在批量${label}中...`;

        clearChaosBatchResults();
        const timeBase = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        let failCount = 0;

        // 串行处理避免多张大图同时解码撑爆内存；每张之间让出主线程刷新进度
        for (let i = 0; i < chaosBatchFiles.length; i++) {
            const file = chaosBatchFiles[i];
            btn.textContent = `⏳ 正在${label} (${i + 1}/${chaosBatchFiles.length})...`;
            await new Promise(r => setTimeout(r, 0));
            try {
                const canvas = await chaosFileToCanvas(file);
                const resultCanvas = ImageChaos.transform(canvas, chaosMode);
                const blob = await new Promise((res, rej) => {
                    resultCanvas.toBlob(b => b ? res(b) : rej(new Error("导出结果失败")), "image/jpeg", 0.95);
                });
                const baseName = (file.name || "image").replace(/\.[^.]+$/, "");
                const filename = `${String(i + 1).padStart(3, "0")}_${baseName}_chaos_${timeBase}.jpg`;
                chaosBatchResults.push({ blob, filename, url: URL.createObjectURL(blob), name: file.name });
            } catch (err) {
                failCount++;
                console.warn(`[混沌批量] ${file.name} 处理失败:`, err);
            }
        }

        if (chaosBatchResults.length === 0) {
            alert(`批量${label}失败：没有一张图片处理成功`);
            btn.disabled = false;
            refreshChaosActionState();
            return;
        }

        // 填充结果网格（复用拆解动图的网格样式，点击可看大图并左右切换）
        const grid = document.getElementById("chaos-batch-grid");
        grid.innerHTML = "";
        chaosBatchResults.forEach((item) => {
            const el = document.createElement("div");
            el.className = "split-frame-item";
            el.innerHTML = `<img src="${item.url}" alt="result" class="zoomable"><div class="split-frame-label">${item.name || item.filename}</div>`;
            el.querySelector("img").addEventListener("click", () => {
                const list = chaosBatchResults
                    .filter(r => r && r.url)
                    .map(r => ({ url: r.url, label: r.filename || "" }));
                const idx = list.findIndex(it => it.url === item.url);
                showModal(list, idx >= 0 ? idx : 0);
            });
            grid.appendChild(el);
        });

        const title = document.getElementById("txt-chaos-batch-title");
        const summary = document.getElementById("txt-chaos-batch-summary");
        if (failCount === 0) {
            title.textContent = `🌀 多图批量${label}完成 (共 ${chaosBatchResults.length} 张)`;
            summary.textContent = `成功处理 ${chaosBatchResults.length} 张图片，可一键全部保存！`;
        } else {
            title.textContent = `🌀 多图批量${label}完成 (成功 ${chaosBatchResults.length} 张，失败 ${failCount} 张)`;
            summary.textContent = `成功 ${chaosBatchResults.length} 张，失败 ${failCount} 张（已跳过问题图片）`;
        }
        document.getElementById("card-chaos-batch").style.display = "block";

        btn.disabled = false;
        refreshChaosActionState();
    }

    // 多图批量结果一键保存
    document.getElementById("btn-chaos-batch-download").addEventListener("click", () => {
        downloadAll(chaosBatchResults);
    });

    // 7. 下载与分享按钮
    document.getElementById("btn-download-disguise").addEventListener("click", () => downloadAll(lastDisguisedResults));
    document.getElementById("btn-download-cover").addEventListener("click", () => {
        const item = lastRestoredResults.find(r => r.coverBlob);
        if (!item) {
            alert("当前没有可保存的伪装封面");
            return;
        }
        const baseName = (item.coverName || "cover").replace(/\.[^.]+$/, "");
        const a = document.createElement("a");
        a.href = item.coverUrl;
        a.download = `${baseName}_cover.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    document.getElementById("btn-download-restored").addEventListener("click", () => downloadAll(lastRestoredResults));

    document.getElementById("btn-share-disguise").addEventListener("click", () => shareResults(lastDisguisedResults));
    document.getElementById("btn-share-restored").addEventListener("click", () => shareResults(lastRestoredResults));

    function downloadAll(results) {
        if (!results || results.length === 0) return;
        results.forEach((item, index) => {
            setTimeout(() => {
                const a = document.createElement("a");
                a.href = item.url;
                a.download = item.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, index * 200);
        });
    }

    async function shareResults(results) {
        if (!results || results.length === 0) return;
        const item = results[0];
        if (navigator.share && navigator.canShare) {
            try {
                const file = new File([item.blob], item.filename, { type: item.blob.type });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: item.filename,
                        text: "分享一张使用 APNG 伪装工具处理的文件"
                    });
                    return;
                }
            } catch (e) {}
        }
        alert("浏览器当前环境不支持系统级直接分享文件，请点击「全部下载保存」后手动发送！");
    }

    // 8. 历史记录 (IndexedDB)
    const DB_NAME = "PNGDisguiseDB";
    const STORE_NAME = "history";

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // 计算来源文件的内容指纹（长度 + 首/中/尾采样字节），用于历史去重。
    // 不引依赖、file:// 下也可用；同一文件重复操作会得到相同指纹。
    async function fileFingerprint(file) {
        try {
            const buf = new Uint8Array(await file.arrayBuffer());
            const len = buf.length;
            let acc = 2166136261 >>> 0;   // FNV-1a 变体，采样若干点混合
            const step = Math.max(1, Math.floor(len / 4096));
            for (let i = 0; i < len; i += step) {
                acc ^= buf[i];
                acc = Math.imul(acc, 16777619) >>> 0;
            }
            // 末尾若干字节也纳入，进一步降低碰撞
            for (let i = Math.max(0, len - 64); i < len; i++) {
                acc ^= buf[i];
                acc = Math.imul(acc, 16777619) >>> 0;
            }
            return len + ":" + acc.toString(16);
        } catch (e) {
            return null;
        }
    }

    async function saveToHistory(type, filename, blob, url, dedupeKey) {
        try {
            const db = await openDB();
            // 去重：同一来源文件（同类型）只保留最新一条记录
            if (dedupeKey) {
                const existingIds = await new Promise((resolve) => {
                    const rtx = db.transaction(STORE_NAME, "readonly");
                    const rq = rtx.objectStore(STORE_NAME).getAll();
                    rq.onsuccess = () => {
                        const ids = rq.result
                            .filter(it => it.type === type && it.dedupeKey === dedupeKey)
                            .map(it => it.id);
                        resolve(ids);
                    };
                    rq.onerror = () => resolve([]);
                });
                if (existingIds.length) {
                    const dtx = db.transaction(STORE_NAME, "readwrite");
                    const store = dtx.objectStore(STORE_NAME);
                    existingIds.forEach(id => store.delete(id));
                    await new Promise(res => { dtx.oncomplete = res; dtx.onerror = res; });
                }
            }
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).add({
                type,
                filename,
                blob,
                size: blob.size,
                time: new Date().toLocaleString("zh-CN"),
                dedupeKey: dedupeKey || null
            });
        } catch (e) {}
    }

    // 历史记录：选择模式状态
    let historySelectMode = false;
    const historySelectedIds = new Set();
    const historyUrlCache = new Map();   // id -> objectURL

    function setHistorySelectMode(on) {
        historySelectMode = on;
        if (!on) historySelectedIds.clear();
        const bar = document.getElementById("history-selection-bar");
        if (bar) bar.hidden = !on;
        const toggle = document.getElementById("btn-select-history");
        if (toggle) toggle.textContent = on ? "完成" : "选择";
        const clearBtn = document.getElementById("btn-clear-history");
        if (clearBtn) clearBtn.hidden = on;
        refreshHistorySelectionUI();
        document.querySelectorAll(".history-item").forEach(el => {
            el.classList.toggle("selectable", on);
        });
    }

    function refreshHistorySelectionUI() {
        document.querySelectorAll(".history-item").forEach(el => {
            const id = Number(el.getAttribute("data-id"));
            el.classList.toggle("selected", historySelectedIds.has(id));
            const box = el.querySelector(".history-check");
            if (box) box.checked = historySelectedIds.has(id);
        });
        const txt = document.getElementById("txt-history-selected");
        if (txt) txt.textContent = `已选 ${historySelectedIds.size} 项`;
    }

    function releaseHistoryUrl(id) {
        const u = historyUrlCache.get(id);
        if (u) { URL.revokeObjectURL(u); historyUrlCache.delete(id); }
    }

    async function deleteHistoryByIds(ids) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        ids.forEach(id => { store.delete(id); releaseHistoryUrl(id); });
        return new Promise(resolve => { tx.oncomplete = () => resolve(); });
    }

    async function renderHistory() {
        const container = document.getElementById("list-history-container");
        container.innerHTML = "";
        // 释放上一轮遗留的 objectURL，避免内存堆积
        historyUrlCache.forEach(u => URL.revokeObjectURL(u));
        historyUrlCache.clear();
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readonly");
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => {
                const list = req.result.reverse();
                let totalBytes = 0;
                list.forEach(item => totalBytes += item.size);

                document.getElementById("txt-history-stat").textContent = 
                    `当前已记录 ${list.length} 个文件 (占用 ${(totalBytes / 1024).toFixed(1)} KB 浏览器本地存储)`;

                if (list.length === 0) {
                    container.innerHTML = `<div class="card" style="text-align: center; color: #94A3B8; padding: 36px;">🍃 暂无任何历史记录，生成的图片会自动保存在这里</div>`;
                    setHistorySelectMode(false);
                    const toggleEmpty = document.getElementById("btn-select-history");
                    if (toggleEmpty) toggleEmpty.disabled = true;
                    return;
                }

                const toggle = document.getElementById("btn-select-history");
                if (toggle) toggle.disabled = false;

                list.forEach(item => {
                    const el = document.createElement("div");
                    el.className = "history-item";
                    el.setAttribute("data-id", item.id);
                    const itemUrl = URL.createObjectURL(item.blob);
                    historyUrlCache.set(item.id, itemUrl);
                    el.innerHTML = `
                        <label class="history-check-wrap">
                            <input type="checkbox" class="history-check" data-id="${item.id}">
                        </label>
                        <img class="history-thumb" src="${itemUrl}" alt="thumb">
                        <div class="history-info">
                            <div><span class="history-tag ${item.type}">${item.type === "disguised" ? "伪装图" : "还原真图"}</span></div>
                            <div class="history-title">${item.filename}</div>
                            <div class="history-meta">${(item.size / 1024).toFixed(1)} KB | ${item.time}</div>
                        </div>
                        <div class="history-actions">
                            <button class="btn-outline btn-preview" data-url="${itemUrl}">查看</button>
                            <button class="btn-outline btn-dl" data-url="${itemUrl}" data-name="${item.filename}">下载</button>
                        </div>
                    `;
                    container.appendChild(el);
                });

                container.querySelectorAll(".btn-preview").forEach(b => {
                    b.addEventListener("click", () => showModal(b.getAttribute("data-url")));
                });
                container.querySelectorAll(".btn-dl").forEach(b => {
                    b.addEventListener("click", () => {
                        const a = document.createElement("a");
                        a.href = b.getAttribute("data-url");
                        a.download = b.getAttribute("data-name");
                        a.click();
                    });
                });
                container.querySelectorAll(".history-check").forEach(cb => {
                    cb.addEventListener("change", () => {
                        const id = Number(cb.getAttribute("data-id"));
                        if (cb.checked) historySelectedIds.add(id);
                        else historySelectedIds.delete(id);
                        refreshHistorySelectionUI();
                    });
                });
                container.querySelectorAll(".history-item").forEach(el => {
                    el.addEventListener("click", (e) => {
                        if (!historySelectMode) return;
                        if (e.target.closest(".history-actions")) return;
                        const id = Number(el.getAttribute("data-id"));
                        if (historySelectedIds.has(id)) historySelectedIds.delete(id);
                        else historySelectedIds.add(id);
                        refreshHistorySelectionUI();
                    });
                });

                // 保持/恢复选择模式（重新渲染后）
                setHistorySelectMode(historySelectMode);
            };
        } catch (e) {
            container.innerHTML = `<div class="card" style="color: #EF4444;">读取本地历史失败</div>`;
        }
    }

    document.getElementById("btn-select-history").addEventListener("click", () => {
        setHistorySelectMode(!historySelectMode);
    });

    document.getElementById("btn-history-select-cancel").addEventListener("click", () => {
        setHistorySelectMode(false);
    });

    document.getElementById("btn-history-select-all").addEventListener("click", () => {
        const all = [...document.querySelectorAll(".history-item")].map(el => Number(el.getAttribute("data-id")));
        const allSelected = all.length > 0 && all.every(id => historySelectedIds.has(id));
        historySelectedIds.clear();
        if (!allSelected) all.forEach(id => historySelectedIds.add(id));
        refreshHistorySelectionUI();
    });

    document.getElementById("btn-history-delete-selected").addEventListener("click", async () => {
        if (historySelectedIds.size === 0) {
            alert("请先勾选要删除的记录");
            return;
        }
        if (!confirm(`确定要删除选中的 ${historySelectedIds.size} 条记录吗？`)) return;
        await deleteHistoryByIds([...historySelectedIds]);
        historySelectedIds.clear();
        renderHistory();
    });

    document.getElementById("btn-clear-history").addEventListener("click", async () => {
        if (!confirm("确定要清空所有本地历史记录与缓存吗？")) return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => renderHistory();
        } catch (e) {}
    });

    // 8.1 清除信息（元数据 / NovelAI 提示词抹除），支持多张
    const boxClean = document.getElementById("box-clean-upload");
    const inputClean = document.getElementById("input-clean-image");
    let cleanSources = [];      // [{ canvas, filename }]
    let cleanResults = [];      // [{ blob, url, filename }]

    boxClean.addEventListener("click", () => inputClean.click());
    enableDropUpload(boxClean, inputClean);

    function clearCleanResult() {
        cleanResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
        cleanResults = [];
        document.getElementById("clean-result-actions").style.display = "none";
        document.getElementById("txt-clean-summary").textContent = "";
    }

    inputClean.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length === 0) return;

        const preview = document.getElementById("img-clean-preview");
        const badge = document.getElementById("badge-clean-info");
        badge.style.display = "block";
        badge.style.color = "";

        const list = [];
        try {
            for (const file of files) {
                const url = URL.createObjectURL(file);
                try {
                    const img = await loadImage(url);
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) continue;
                    // 清除信息不改变画面内容，按原始尺寸处理，不做任何缩小
                    const canvas = document.createElement("canvas");
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
                    list.push({ canvas, filename: file.name });
                } finally {
                    URL.revokeObjectURL(url);
                }
            }
        } catch (err) {
            alert("读取图片失败: " + err.message);
        }

        if (list.length === 0) {
            alert("未能读取到有效图片");
            return;
        }

        cleanSources = list;
        clearCleanResult();

        // 首张作为预览
        const firstUrl = list[0].canvas.toDataURL("image/jpeg", 0.95);
        preview.src = firstUrl;
        preview.style.display = "block";
        boxClean.querySelector(".upload-icon").style.display = "none";
        boxClean.querySelector(".upload-text").style.display = "none";
        boxClean.querySelector(".upload-hint").style.display = "none";

        if (list.length === 1) {
            badge.textContent = `已选: ${list[0].filename} (${list[0].canvas.width}x${list[0].canvas.height})`;
        } else {
            badge.textContent = `已选 ${list.length} 张图片，将逐张清除信息（按原始尺寸，不缩小）`;
        }
    });

    document.getElementById("btn-clean-run").addEventListener("click", () => {
        if (cleanSources.length === 0) { alert("请先选择图片"); return; }
        const btn = document.getElementById("btn-clean-run");
        btn.disabled = true;
        const total = cleanSources.length;
        btn.textContent = `⏳ 正在清除信息... (0/${total})`;

        // 释放上一轮结果
        cleanResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
        cleanResults = [];

        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        let idx = 0;

        const processNext = () => {
            if (idx >= total) {
                finishClean(total);
                return;
            }
            const item = cleanSources[idx];
            const out = document.createElement("canvas");
            out.width = item.canvas.width;
            out.height = item.canvas.height;
            out.getContext("2d").drawImage(item.canvas, 0, 0);
            stripAlphaLSB(out);

            out.toBlob(blob => {
                if (blob) {
                    const baseName = (item.filename || "image").replace(/\.[^.]+$/, "");
                    cleanResults.push({
                        blob,
                        url: URL.createObjectURL(blob),
                        filename: `${baseName}_clean_${stamp}.png`
                    });
                }
                idx++;
                btn.textContent = `⏳ 正在清除信息... (${idx}/${total})`;
                setTimeout(processNext, 0);
            }, "image/png");
        };

        const finishClean = (count) => {
            btn.disabled = false;
            btn.textContent = "🧹 立即清除信息";
            if (cleanResults.length === 0) {
                alert("清除信息失败：未能生成结果");
                return;
            }
            const totalSize = cleanResults.reduce((s, r) => s + r.blob.size, 0);
            document.getElementById("clean-result-actions").style.display = "flex";
            document.getElementById("txt-clean-summary").textContent =
                (count === 1 ? "信息清除完成" : `批量清除完成（共 ${cleanResults.length} 张）`)
                + `（已移除 EXIF / 位置 / NovelAI 提示词等隐藏信息，输出不含元数据的 PNG）| 合计大小 ${(totalSize / 1024).toFixed(1)} KB`;
        };

        setTimeout(processNext, 30);
    });

    document.getElementById("btn-clean-download").addEventListener("click", () => {
        if (cleanResults.length === 0) return;
        cleanResults.forEach((r, i) => {
            setTimeout(() => {
                const a = document.createElement("a");
                a.href = r.url;
                a.download = r.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, i * 200);
        });
    });

    // 8.1.1 信息查看：EXIF/GPS/文本块 本地解析（与「信息清除」共用上传框）
    // JPEG APP1 与 PNG eXIf 里都是 TIFF 结构，统一按 IFD 遍历解析。
    const META_TAG_NAMES = {
        0x010F: "相机制造商", 0x0110: "相机型号", 0x0112: "拍摄方向",
        0x0131: "软件", 0x0132: "修改时间", 0x013B: "作者",
        0x8298: "版权", 0x829A: "曝光时间", 0x829D: "光圈值 F",
        0x8827: "ISO", 0x9000: "Exif 版本", 0x9003: "拍摄时间",
        0x9004: "数字化时间", 0x9201: "快门速度", 0x9202: "光圈",
        0x9204: "曝光补偿", 0x9207: "测光模式", 0x9209: "闪光灯",
        0x920A: "焦距", 0x9286: "用户注释",
        0xA002: "图像宽度", 0xA003: "图像高度",
        0xA432: "镜头参数", 0xA433: "镜头制造商", 0xA434: "镜头型号",
        0xA430: "相机所有者", 0xA431: "相机序列号",
        0x8769: "ExifIFD", 0x8825: "GPSIFD"
    };
    const GPS_TAG_NAMES = {
        0x0000: "GPS 版本", 0x0001: "纬度半球", 0x0002: "纬度",
        0x0003: "经度半球", 0x0004: "经度", 0x0005: "海拔基准",
        0x0006: "海拔(米)", 0x0007: "时间戳", 0x000B: "GPS 日期",
        0x0011: "拍摄朝向"
    };
    // 展示时值得标红提醒的敏感字段
    const META_DANGER_KEYS = ["纬度", "经度", "拍摄时间", "数字化时间", "相机所有者", "作者", "相机序列号", "纬度半球", "经度半球", "海拔(米)", "GPS 日期", "拍摄朝向", "时间戳"];

    function metaReadU16(v, o, le) { return le ? (v[o] | (v[o + 1] << 8)) : ((v[o] << 8) | v[o + 1]); }
    function metaReadU32(v, o, le) { return le ? (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0 : (((v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]) >>> 0); }

    // 解析 TIFF（EXIF 头后就是 IFD0），返回 { exif: [[k,v]], gps: [[k,v]], gpsCoord: {lat,lon}|null }
    function parseTiffExif(tiff, isBE) {
        const exifRows = [], gpsRows = [];
        let gpsCoord = null;
        try {
            const ifd0Off = metaReadU32(tiff, 4, !isBE);
            const readIFD = (off, target, tagNames) => {
                if (off + 2 > tiff.length) return 0;
                const count = metaReadU16(tiff, off, !isBE);
                for (let i = 0; i < count; i++) {
                    const e = off + 2 + i * 12;
                    if (e + 12 > tiff.length) break;
                    const tag = metaReadU16(tiff, e, !isBE);
                    const type = metaReadU16(tiff, e + 2, !isBE);
                    const num = metaReadU32(tiff, e + 4, !isBE);
                    const valOff = num * (META_TYPE_SIZE[type] || 0) > 4 ? metaReadU32(tiff, e + 8, !isBE) : e + 8;
                    const val = metaReadValue(tiff, type, num, valOff, !isBE);
                    if (val === null) continue;
                    const name = tagNames[tag] || ("0x" + tag.toString(16).toUpperCase());
                    target.push([name, val]);
                }
                return count;
            };

            // IFD0：先收集普通字段，再跳转 ExifIFD / GPSIFD
            const ifd0 = [];
            readIFD(ifd0Off, ifd0, META_TAG_NAMES);
            let exifIfdOff = 0, gpsIfdOff = 0;
            for (const [k, v] of ifd0) {
                if (k === "ExifIFD") exifIfdOff = parseInt(v) || 0;
                else if (k === "GPSIFD") gpsIfdOff = parseInt(v) || 0;
                else exifRows.push([k, v]);
            }
            if (exifIfdOff) readIFD(exifIfdOff, exifRows, META_TAG_NAMES);
            if (gpsIfdOff) {
                readIFD(gpsIfdOff, gpsRows, GPS_TAG_NAMES);
                gpsCoord = metaGpsToCoord(gpsRows);
            }
        } catch (e) { /* 解析失败按无 EXIF 处理 */ }
        return { exif: exifRows, gps: gpsRows, gpsCoord };
    }

    const META_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    function metaReadValue(v, type, num, off, le) {
        try {
            if (type === 2) {   // ASCII
                let s = "";
                for (let i = 0; i < num && off + i < v.length; i++) {
                    const c = v[off + i];
                    if (c === 0) break;
                    s += String.fromCharCode(c);
                }
                return s.trim() || null;
            }
            if (type === 3) return num === 1 ? metaReadU16(v, off, le) : (num <= 4 ? Array.from({ length: num }, (_, i) => metaReadU16(v, off + i * 2, le)).join(", ") : null);
            if (type === 4) return num === 1 ? metaReadU32(v, off, le) : (num <= 4 ? Array.from({ length: num }, (_, i) => metaReadU32(v, off + i * 4, le)).join(", ") : null);
            if (type === 5 && num >= 1 && num <= 4) {   // RATIONAL（GPS 度分秒、海拔等）
                const vals = [];
                for (let i = 0; i < num; i++) {
                    const n = metaReadU32(v, off + i * 8, le);
                    const d = metaReadU32(v, off + i * 8 + 4, le);
                    vals.push(d === 0 ? 0 : n / d);
                }
                return num === 1 ? vals[0] : vals.join(", ");
            }
            return null;
        } catch (e) { return null; }
    }

    // GPS 度分秒（3 个 RATIONAL）→ 十进制经纬度
    function metaGpsToCoord(rows) {
        const get = name => { const r = rows.find(x => x[0] === name); return r ? r[1] : null; };
        const lat = get("纬度"), lon = get("经度");
        if (typeof lat !== "string" || typeof lon !== "string") return null;
        const la = lat.split(",").map(Number), lo = lon.split(",").map(Number);
        if (la.length !== 3 || lo.length !== 3 || la.some(isNaN) || lo.some(isNaN)) return null;
        let dLat = la[0] + la[1] / 60 + la[2] / 3600;
        let dLon = lo[0] + lo[1] / 60 + lo[2] / 3600;
        if (get("纬度半球") === "S") dLat = -dLat;
        if (get("经度半球") === "W") dLon = -dLon;
        if (Math.abs(dLat) > 90 || Math.abs(dLon) > 180) return null;
        return { lat: dLat.toFixed(6), lon: dLon.toFixed(6) };
    }

    // 从文件字节提取 EXIF（JPEG APP1 / PNG eXIf）并解析
    async function parseImageMeta(file) {
        const raw = new Uint8Array(await file.arrayBuffer());
        let tiff = null, isBE = false;
        if (raw[0] === 0xFF && raw[1] === 0xD8) {
            // JPEG：找 APP1 "Exif\0\0"
            let pos = 2;
            while (pos + 4 <= raw.length) {
                const len = (raw[pos + 2] << 8) | raw[pos + 3];
                if (raw[pos] === 0xFF && raw[pos + 1] === 0xE1 && len >= 8 &&
                    raw[pos + 4] === 0x45 && raw[pos + 5] === 0x78 && raw[pos + 6] === 0x69 && raw[pos + 7] === 0x66) {
                    tiff = raw.slice(pos + 10);   // 跳过 "Exif\0\0"
                    break;
                }
                if (raw[pos] === 0xFF && raw[pos + 1] === 0xDA) break;
                if (len <= 0) break;
                pos += 2 + len;
            }
        } else if (raw[0] === 0x89 && raw[1] === 0x50) {
            const chunks = ApngCodec.parseChunks(raw);
            const exifChunk = chunks.find(c => c.type === "eXIf");
            if (exifChunk) tiff = exifChunk.payload;
        }
        if (!tiff || tiff.length < 8) return { exif: [], gps: [], gpsCoord: null, textChunks: extractMetaChunks(raw) };

        const isLE = tiff[0] === 0x49 && tiff[1] === 0x49;
        isBE = tiff[0] === 0x4D && tiff[1] === 0x4D;
        if (!isLE && !isBE) return { exif: [], gps: [], gpsCoord: null, textChunks: extractMetaChunks(raw) };

        const parsed = parseTiffExif(tiff, isBE);
        parsed.textChunks = extractMetaChunks(raw).filter(c => c.type !== "eXIf");
        return parsed;
    }

    // 渲染单张图片的解析结果
    function renderMetaView(file, meta) {
        const wrap = document.createElement("div");
        wrap.className = "meta-view-file";

        const hasContent = meta.exif.length > 0 || meta.gps.length > 0 || meta.textChunks.length > 0;
        const pill = document.createElement("span");
        pill.className = "file-pill" + (hasContent ? " warn" : "");
        pill.textContent = hasContent ? "含隐藏信息" : "未发现隐藏信息";
        const name = document.createElement("span");
        name.textContent = file.name;
        name.style.overflow = "hidden";
        name.style.textOverflow = "ellipsis";
        name.style.whiteSpace = "nowrap";
        wrap.appendChild(pill);
        wrap.appendChild(name);
        const out = [wrap];

        const mkTable = (title, rows) => {
            if (rows.length === 0) return null;
            const holder = document.createElement("div");
            let html = `<table class="meta-table"><tr><th style="width:96px;">${title}</th><th>内容</th></tr>`;
            for (const [k, v] of rows) {
                const danger = META_DANGER_KEYS.includes(k) ? " class=\"danger\"" : "";
                html += `<tr${danger}><td class="meta-k">${k}</td><td class="meta-v">${escapeHtml(String(v))}</td></tr>`;
            }
            html += "</table>";
            holder.innerHTML = html;
            return holder;
        };

        if (meta.gpsCoord) {
            const { lat, lon } = meta.gpsCoord;
            const p = document.createElement("div");
            p.className = "meta-note";
            p.innerHTML = `📍 拍摄地点约在 <a class="meta-gps-link" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}" target="_blank" rel="noopener">${lat}, ${lon}</a>（点击在新标签页打开地图，浏览器不会上传任何数据）`;
            out.push(p);
        }
        const t1 = mkTable("位置 GPS", meta.gps);
        if (t1) out.push(t1);
        const t2 = mkTable("拍摄参数", meta.exif);
        if (t2) out.push(t2);

        // 文本块（tEXt/iTXt/zTXt，NovelAI 参数就在这里）
        const textRows = [];
        for (const c of meta.textChunks) {
            let val = "";
            try {
                if (c.type === "tEXt") {
                    const z = c.payload.indexOf(0);
                    val = new TextDecoder().decode(c.payload.slice(0, z)) + " = " +
                          new TextDecoder().decode(c.payload.slice(z + 1, Math.min(c.payload.length, z + 1 + 800)));
                } else {
                    val = `[${c.type}] ${c.payload.length} 字节`;
                }
            } catch (e) { val = `[${c.type}] ${c.payload.length} 字节`; }
            textRows.push([c.type, val]);
        }
        const t3 = mkTable("文本块", textRows);
        if (t3) out.push(t3);

        if (!hasContent) {
            const n = document.createElement("div");
            n.className = "meta-note";
            n.textContent = "未解析到 EXIF / GPS / 文本块。可能原因：聊天软件转发时已剥离、截图本身不含、或为不支持的格式（如 HEIC）。";
            out.push(n);
        }
        return out;
    }

    // 选图后刷新「信息查看」
    async function refreshMetaView(files) {
        const box = document.getElementById("meta-view-result");
        box.innerHTML = "";
        for (const f of files.slice(0, 20)) {   // 最多展示 20 张，避免卡顿
            try {
                const meta = await parseImageMeta(f);
                renderMetaView(f, meta).forEach(el => box.appendChild(el));
            } catch (e) { /* 单张失败跳过 */ }
        }
    }

    // 挂到现有上传流程：clean 的 change 事件里同步刷新（在原监听器之后追加）
    inputClean.addEventListener("change", () => {
        const files = inputClean.files ? Array.from(inputClean.files) : [];
        if (files.length > 0) refreshMetaView(files);
    });

    function escapeHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // 8.2 电子包浆（复刻 Electrical Weathering v4，纯 Canvas 实现）
    // 管线：可选水印 → 噪点(高斯混合) → 泛绿 → 压缩/缩放（官窑与民窑步骤顺序不同）
    const boxEW = document.getElementById("box-ew-upload");
    const inputEW = document.getElementById("input-ew-image");
    let ewSourceCanvas = null;   // 原图 canvas
    let ewResultBlob = null;
    let ewResultUrl = null;
    let ewMode = "classic";      // classic=官窑(SkiaYUV 误差累积) ng=民窑(矩阵混合)
    let ewWatermarks = [];       // 预加载的水印 Image 对象
    let ewRunning = false;

    // 预设与原版一致：低(0,0.05,0.8) 中(0.02,0.1,0.85) 高(0.05,0.15,0.9)
    const EW_PRESETS = {
        low:    { noise: 0,    green: 0.05, quality: 0.8,  scale: 1 },
        medium: { noise: 0.02, green: 0.1,  quality: 0.85, scale: 1 },
        high:   { noise: 0.05, green: 0.15, quality: 0.9,  scale: 1 }
    };

    // 预加载水印（内嵌 data URL，file:// 下不会污染 canvas）
    (function loadEwWatermarks() {
        const src = window.EW_WATERMARKS || {};
        Object.keys(src).forEach(k => {
            const img = new Image();
            img.onload = () => ewWatermarks.push(img);
            img.src = src[k];
        });
    })();

    boxEW.addEventListener("click", () => inputEW.click());
    enableDropUpload(boxEW, inputEW);

    const ewSliders = {
        noise:   document.getElementById("ew-slider-noise"),
        green:   document.getElementById("ew-slider-green"),
        quality: document.getElementById("ew-slider-quality"),
        scale:   document.getElementById("ew-slider-scale")
    };

    function refreshEwSliderVals() {
        document.getElementById("ew-val-noise").textContent = Math.round(ewSliders.noise.value * 100) + "%";
        document.getElementById("ew-val-green").textContent = Math.round(ewSliders.green.value * 100) + "%";
        document.getElementById("ew-val-quality").textContent = Math.round(ewSliders.quality.value * 100) + "%";
        document.getElementById("ew-val-scale").textContent = Math.round(ewSliders.scale.value * 100) + "%";
    }
    Object.values(ewSliders).forEach(s => s.addEventListener("input", () => {
        setEwPreset("custom");
        refreshEwSliderVals();
    }));
    refreshEwSliderVals();

    function setEwPreset(name) {
        document.querySelectorAll("#ew-preset-group .segmented-btn").forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-preset") === name);
        });
    }

    document.querySelectorAll("#ew-preset-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const p = btn.getAttribute("data-preset");
            if (p !== "custom" && EW_PRESETS[p]) {
                const v = EW_PRESETS[p];
                ewSliders.noise.value = v.noise;
                ewSliders.green.value = v.green;
                ewSliders.quality.value = v.quality;
                ewSliders.scale.value = v.scale;
                refreshEwSliderVals();
            }
            setEwPreset(p);
        });
    });

    document.querySelectorAll("#ew-mode-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#ew-mode-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            ewMode = btn.getAttribute("data-mode");
        });
    });

    inputEW.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const preview = document.getElementById("img-ew-preview");
        try {
            const img = await loadImage(URL.createObjectURL(file));
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error("图片尺寸无效");
            ewSourceCanvas = document.createElement("canvas");
            ewSourceCanvas.width = w;
            ewSourceCanvas.height = h;
            ewSourceCanvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);

            preview.src = ewSourceCanvas.toDataURL("image/jpeg", 0.95);
            preview.style.display = "block";
            boxEW.querySelector(".upload-icon").style.display = "none";
            boxEW.querySelector(".upload-text").style.display = "none";
            boxEW.querySelector(".upload-hint").style.display = "none";
            clearEwResult();

            const badge = document.getElementById("badge-ew-info");
            badge.style.display = "block";
            badge.style.color = "";
            badge.textContent = `已选: ${file.name} (${w}x${h})`;
            // 与原版一致：图片太小不允许叠水印
            document.getElementById("chk-ew-watermark").disabled = !(w >= 240 && h >= 120);
        } catch (err) {
            alert("图片加载失败: " + err.message);
        }
    });

    function clearEwResult() {
        if (ewResultUrl) {
            URL.revokeObjectURL(ewResultUrl);
            ewResultUrl = null;
        }
        ewResultBlob = null;
        const out = document.getElementById("img-ew-out");
        out.removeAttribute("src");
        out.hidden = true;
        document.getElementById("ew-empty-out").hidden = false;
        document.getElementById("card-ew-result").style.display = "none";
        document.getElementById("txt-ew-summary").textContent = "";
    }

    // ---- 核心算法（逐条对应原版 WeatheringMachine.cs）----

    // 噪点：高斯噪声图与原图按强度混合（对应 Noising，Randn 均值0标准差255）
    function ewNoising(canvas, intensity) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        let seed = (Date.now() ^ (Math.random() * 0xFFFFFFFF)) >>> 0;
        const rnd = () => {
            seed ^= seed << 13; seed >>>= 0;
            seed ^= seed >>> 17;
            seed ^= seed << 5;  seed >>>= 0;
            return seed / 4294967296;
        };
        // Box-Muller 生成正态分布，除以 255 对齐原版标准差
        const gauss = () => {
            const u = Math.max(1e-9, rnd());
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
        };
        const k = intensity;
        for (let i = 0; i < px.length; i += 4) {
            px[i]     = Math.round((1 - k) * px[i]     + k * (gauss() * 255));
            px[i + 1] = Math.round((1 - k) * px[i + 1] + k * (gauss() * 255));
            px[i + 2] = Math.round((1 - k) * px[i + 2] + k * (gauss() * 255));
        }
        ctx.putImageData(img, 0, 0);
    }

    // 民窑泛绿：纯绿混合 + 压暗 + G 通道抬升，三步矩阵运算（对应 Greening）
    function ewGreeningNG(canvas, intensity) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        const k = intensity;
        for (let i = 0; i < px.length; i += 4) {
            // 1) 与纯绿 (0,255,0) 按强度混合
            let R = (1 - k) * px[i]     + k * 0;
            let G = (1 - k) * px[i + 1] + k * 255;
            let B = (1 - k) * px[i + 2] + k * 0;
            // 2) 全图压暗 128×强度（原版 ConvertTo 1.0, -128i）
            R -= 128 * k; G -= 128 * k; B -= 128 * k;
            // 3) G 通道单独 +32×强度
            G += 32 * k;
            px[i]     = Math.round(Math.max(0, Math.min(255, R)));
            px[i + 1] = Math.round(Math.max(0, Math.min(255, G)));
            px[i + 2] = Math.round(Math.max(0, Math.min(255, B)));
        }
        ctx.putImageData(img, 0, 0);
    }

    // 水印：右下角原样覆盖 alpha>0 的像素（对应 AddWatermark，不缩放）
    function ewAddWatermarks(canvas) {
        if (ewWatermarks.length === 0) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        for (const wm of ewWatermarks) {
            const x = canvas.width - wm.width;
            const y = canvas.height - wm.height;
            if (x < 0 || y < 0) continue;
            ctx.drawImage(wm, x, y);
        }
    }

    // 压缩：JPEG 往返（对应 Compressing，质量 = (1-强度)×100）
    function ewCompress(canvas, intensity) {
        return new Promise(resolve => {
            const url = canvas.toDataURL("image/jpeg", Math.max(0.01, 1 - intensity));
            const img = new Image();
            img.onload = () => {
                const out = document.createElement("canvas");
                out.width = canvas.width;
                out.height = canvas.height;
                out.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
                resolve(out);
            };
            img.onerror = () => resolve(canvas);
            img.src = url;
        });
    }

    // 缩放：等比缩放（对应 Resize，INTER_AREA）
    function ewScale(canvas, ratio) {
        const w = Math.max(1, Math.round(canvas.width * ratio));
        const h = Math.max(1, Math.round(canvas.height * ratio));
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const ctx = out.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(canvas, 0, 0, w, h);
        return out;
    }

    function cloneCanvas(src) {
        const out = document.createElement("canvas");
        out.width = src.width;
        out.height = src.height;
        out.getContext("2d", { willReadFrequently: true }).drawImage(src, 0, 0);
        return out;
    }

    // 官窑泛绿：整数定点 RGB→YUV→RGB 往返，误差逐轮累积（对应 SkiaYUV ×N 轮）
    function ewGreeningClassicRounds(canvas, rounds) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = img.data;
        const clampRGB = x => x < 0 ? 0 : (x > 255 ? 255 : x);
        const clampUV = x => x < -128 ? -128 : (x > 127 ? 127 : x);
        for (let r = 0; r < rounds; r++) {
            for (let i = 0; i < px.length; i += 4) {
                const R = px[i], G = px[i + 1], B = px[i + 2];
                // 原版权重 77/150/29（BGR 序）+ 每通道 -1 偏移，制造 YUV 舍入误差
                const Y  = clampRGB(((77 * G + 150 * R + 29 * B) >> 8) - 1);
                const U  = clampUV(((-43 * G - 85 * R + 128 * B) >> 8) - 1);
                const V  = clampUV(((128 * G - 107 * R - 21 * B) >> 8) - 1);
                const y16 = Y << 16;
                px[i]     = clampRGB((y16 + 116130 * U) >> 16);
                px[i + 1] = clampRGB((y16 - 22553 * U - 46802 * V) >> 16);
                px[i + 2] = clampRGB((y16 + 91881 * V) >> 16);
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    async function ewProcess() {
        // 官窑顺序：水印→噪点→泛绿→缩放→压缩；民窑顺序：水印→噪点→泛绿→压缩→缩放
        let canvas = cloneCanvas(ewSourceCanvas);

        const useWm = document.getElementById("chk-ew-watermark").checked;
        if (useWm) ewAddWatermarks(canvas);

        const p = {
            noise: parseFloat(ewSliders.noise.value),
            green: parseFloat(ewSliders.green.value),
            quality: parseFloat(ewSliders.quality.value),
            scale: parseFloat(ewSliders.scale.value)
        };

        if (p.noise > 0) ewNoising(canvas, p.noise);

        if (p.green > 0) {
            if (ewMode === "classic") {
                // 官窑逐轮误差累积，轮间让出主线程刷新进度
                const rounds = Math.round(p.green * 100);
                const per = Math.max(1, Math.ceil(rounds / 20));
                let done = 0;
                while (done < rounds) {
                    const step = Math.min(per, rounds - done);
                    ewGreeningClassicRounds(canvas, step);
                    done += step;
                    await new Promise(r => setTimeout(r, 0));
                }
            } else {
                ewGreeningNG(canvas, p.green);
            }
        }

        if (ewMode === "classic") {
            if (p.scale !== 1) canvas = ewScale(canvas, p.scale);
            if (p.quality > 0) canvas = await ewCompress(canvas, p.quality);
        } else {
            if (p.quality > 0) canvas = await ewCompress(canvas, p.quality);
            if (p.scale !== 1) canvas = ewScale(canvas, p.scale);
        }
        return canvas;
    }

    document.getElementById("btn-ew-run").addEventListener("click", async () => {
        if (!ewSourceCanvas) { alert("请先选择一张图片"); return; }
        if (ewRunning) return;
        ewRunning = true;

        const btn = document.getElementById("btn-ew-run");
        const label = ewMode === "classic" ? "官窑" : "民窑";
        btn.disabled = true;
        btn.textContent = `⏳ ${label}包浆中...`;
        const t0 = performance.now();

        try {
            const result = await ewProcess();
            const blob = await new Promise((res, rej) => {
                result.toBlob(b => b ? res(b) : rej(new Error("导出失败")), "image/jpeg", 0.92);
            });
            if (ewResultUrl) URL.revokeObjectURL(ewResultUrl);
            ewResultBlob = blob;
            ewResultUrl = URL.createObjectURL(blob);

            const outEl = document.getElementById("img-ew-out");
            outEl.src = ewResultUrl;
            outEl.hidden = false;
            document.getElementById("ew-empty-out").hidden = true;
            document.getElementById("card-ew-result").style.display = "block";
            document.getElementById("txt-ew-result-title").textContent = `🏺 ${label}包浆完成`;
            document.getElementById("txt-ew-summary").textContent =
                `耗时 ${Math.round(performance.now() - t0)}ms | 成品 ${result.width}x${result.height} | 大小 ${(blob.size / 1024).toFixed(1)} KB`;
        } catch (err) {
            alert("包浆失败: " + err.message);
        } finally {
            ewRunning = false;
            btn.disabled = false;
            btn.textContent = "🏺 立即包浆";
        }
    });

    document.getElementById("btn-ew-revert").addEventListener("click", () => {
        if (!ewSourceCanvas) { alert("请先选择一张图片"); return; }
        clearEwResult();
        alert("已还原为原图（包浆不可逆，请以本地图册里的原图为准）");
        const preview = document.getElementById("img-ew-preview");
        preview.src = ewSourceCanvas.toDataURL("image/jpeg", 0.95);
        preview.style.display = "block";
    });

    document.getElementById("btn-ew-download").addEventListener("click", () => {
        if (!ewResultBlob) return;
        const a = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        a.href = ewResultUrl;
        a.download = `weathered_${stamp}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    // 点击成品可查看大图（支持缩放）
    document.getElementById("img-ew-out").addEventListener("click", () => {
        const el = document.getElementById("img-ew-out");
        if (el && el.getAttribute("src") && !el.hidden) {
            showModal(el.src);
        }
    });

    // 8.3 图片处理：多图竖拼 / 横拼（拖拽排序 + 实时预览 + 圆角 + 最小/最大化对齐）
    const boxMerge = document.getElementById("box-merge-upload");
    const inputMerge = document.getElementById("input-merge-image");
    let mergeFiles = [];        // [{ file, img, w, h }] 按拼接顺序
    let mergeDirection = "v";   // v=竖拼 h=横拼
    let mergeBg = "transparent";
    let mergeUnify = "max";     // none=原始尺寸 min=最小化 max=最大化（默认最大化）
    let mergeRadiusMode = "each"; // each=每张单图圆角 whole=合成后整图圆角
    let mergeResultBlob = null; // 保存用的最终 blob
    let mergeResultUrl = null;

    boxMerge.addEventListener("click", () => inputMerge.click());
    enableDropUpload(boxMerge, inputMerge);

    document.querySelectorAll("#merge-direction-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-direction-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeDirection = btn.getAttribute("data-dir");
            scheduleMergePreview();
        });
    });

    document.querySelectorAll("#merge-unify-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-unify-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeUnify = btn.getAttribute("data-unify");
            scheduleMergePreview();
        });
    });

    document.querySelectorAll("#merge-bg-group .merge-bg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-bg-group .merge-bg-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeBg = btn.getAttribute("data-bg");
            scheduleMergePreview();
        });
    });

    document.querySelectorAll("#merge-radius-mode-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-radius-mode-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeRadiusMode = btn.getAttribute("data-radius-mode");
            scheduleMergePreview();
        });
    });

    const mergeSliderGap = document.getElementById("merge-slider-gap");
    const mergeSliderMargin = document.getElementById("merge-slider-margin");
    const mergeSliderRadius = document.getElementById("merge-slider-radius");
    function refreshMergeVals() {
        document.getElementById("merge-val-gap").textContent = mergeSliderGap.value + "px";
        document.getElementById("merge-val-margin").textContent = mergeSliderMargin.value + "px";
        document.getElementById("merge-val-radius").textContent = mergeSliderRadius.value + "px";
    }
    [mergeSliderGap, mergeSliderMargin, mergeSliderRadius].forEach(s => {
        s.addEventListener("input", () => { refreshMergeVals(); scheduleMergePreview(); });
    });
    refreshMergeVals();

    // 渲染已选文件列表（拖拽手柄 + 序号 + 文件名 + 上移/下移/删除）
    let dragSrcIndex = -1;
    function renderMergeList() {
        const listEl = document.getElementById("merge-file-list");
        listEl.innerHTML = "";
        mergeFiles.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = "merge-file-item";
            row.draggable = true;
            row.dataset.index = String(i);

            // 拖拽排序（HTML5 DnD，桌面鼠标与移动端长按均触发）
            row.addEventListener("dragstart", (e) => {
                dragSrcIndex = i;
                row.classList.add("dragging");
                try { e.dataTransfer.setData("text/plain", String(i)); } catch (err) {}
                e.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("dragging");
                listEl.querySelectorAll(".merge-file-item").forEach(r => r.classList.remove("drag-over-top", "drag-over-bottom"));
                dragSrcIndex = -1;
            });
            row.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = row.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                row.classList.toggle("drag-over-top", before);
                row.classList.toggle("drag-over-bottom", !before);
            });
            row.addEventListener("dragleave", () => row.classList.remove("drag-over-top", "drag-over-bottom"));
            row.addEventListener("drop", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = row.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                row.classList.remove("drag-over-top", "drag-over-bottom");
                let src = dragSrcIndex;
                if (src < 0) {
                    const raw = e.dataTransfer.getData("text/plain");
                    if (raw === "" || isNaN(parseInt(raw, 10))) return;
                    src = parseInt(raw, 10);
                }
                if (src < 0 || src >= mergeFiles.length) return;
                let dst = before ? i : i + 1;
                if (src === dst || src === dst - 1) return;   // 位置没变
                const [moved] = mergeFiles.splice(src, 1);
                if (dst > src) dst--;
                mergeFiles.splice(dst, 0, moved);
                renderMergeList();
                scheduleMergePreview();
            });

            const handle = document.createElement("span");
            handle.className = "merge-drag-handle";
            handle.textContent = "⠿";
            handle.title = "拖拽调整顺序";
            const order = document.createElement("span");
            order.className = "merge-file-order";
            order.textContent = String(i + 1);
            const name = document.createElement("span");
            name.className = "merge-file-name";
            name.textContent = `${item.file.name} (${item.w}x${item.h})`;
            const updown = document.createElement("span");
            updown.className = "merge-file-updown";
            const upBtn = document.createElement("button");
            upBtn.textContent = "▲";
            upBtn.title = "上移";
            upBtn.disabled = i === 0;
            upBtn.addEventListener("click", () => {
                if (i === 0) return;
                [mergeFiles[i - 1], mergeFiles[i]] = [mergeFiles[i], mergeFiles[i - 1]];
                renderMergeList();
                scheduleMergePreview();
            });
            const downBtn = document.createElement("button");
            downBtn.textContent = "▼";
            downBtn.title = "下移";
            downBtn.disabled = i === mergeFiles.length - 1;
            downBtn.addEventListener("click", () => {
                if (i === mergeFiles.length - 1) return;
                [mergeFiles[i + 1], mergeFiles[i]] = [mergeFiles[i], mergeFiles[i + 1]];
                renderMergeList();
                scheduleMergePreview();
            });
            updown.appendChild(upBtn);
            updown.appendChild(downBtn);
            const del = document.createElement("button");
            del.className = "merge-file-del";
            del.textContent = "✕";
            del.title = "移除";
            del.addEventListener("click", () => {
                mergeFiles.splice(i, 1);
                renderMergeList();
                refreshMergeBadge();
                scheduleMergePreview();
            });
            row.appendChild(handle);
            row.appendChild(order);
            row.appendChild(name);
            row.appendChild(updown);
            row.appendChild(del);
            listEl.appendChild(row);
        });
    }

    function refreshMergeBadge() {
        const badge = document.getElementById("badge-merge-info");
        const preview = document.getElementById("img-merge-preview");
        if (mergeFiles.length === 0) {
            badge.style.display = "none";
            preview.removeAttribute("src");
            preview.style.display = "none";
            boxMerge.querySelector(".upload-icon").style.display = "";
            boxMerge.querySelector(".upload-text").style.display = "";
            boxMerge.querySelector(".upload-hint").style.display = "";
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = mergeFiles.length === 1
            ? `已选 1 张图片（再选几张即可拼接）`
            : `已选 ${mergeFiles.length} 张图片，按列表顺序${mergeDirection === "v" ? "竖向" : "横向"}拼接`;
        preview.src = mergeFiles[0].img.src;
        preview.style.display = "block";
        boxMerge.querySelector(".upload-icon").style.display = "none";
        boxMerge.querySelector(".upload-text").style.display = "none";
        boxMerge.querySelector(".upload-hint").style.display = "none";
    }

    inputMerge.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length === 0) return;
        inputMerge.value = "";

        let added = 0;
        for (const file of files) {
            try {
                const img = await loadImage(URL.createObjectURL(file));
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) continue;
                mergeFiles.push({ file, img, w, h });
                added++;
            } catch (err) { /* 单张失败跳过 */ }
        }
        if (added === 0) {
            alert("未能读取到有效图片");
            return;
        }
        renderMergeList();
        refreshMergeBadge();
        scheduleMergePreview();
    });

    // ---- 拼接核心：返回 { canvas, sizes } ----
    function buildMergeCanvas() {
        const gap = parseInt(mergeSliderGap.value, 10);
        const margin = parseInt(mergeSliderMargin.value, 10);
        const radius = parseInt(mergeSliderRadius.value, 10);
        const vertical = mergeDirection === "v";

        // 基准：none=不统一；min=最小宽度/高度；max=最大宽度/高度
        let base = null;
        if (mergeUnify !== "none") {
            const dims = mergeFiles.map(item => vertical ? item.w : item.h);
            base = mergeUnify === "min" ? Math.min(...dims) : Math.max(...dims);
        }

        const sizes = mergeFiles.map(item => {
            if (base === null) return { w: item.w, h: item.h, img: item.img };
            if (vertical) {
                const s = base / item.w;
                return { w: Math.round(base), h: Math.max(1, Math.round(item.h * s)), img: item.img };
            }
            const s = base / item.h;
            return { w: Math.max(1, Math.round(item.w * s)), h: Math.round(base), img: item.img };
        });

        let cw, ch;
        if (vertical) {
            cw = margin * 2 + Math.max(...sizes.map(s => s.w));
            ch = margin * 2 + sizes.reduce((s, x) => s + x.h, 0) + gap * (sizes.length - 1);
        } else {
            cw = margin * 2 + sizes.reduce((s, x) => s + x.w, 0) + gap * (sizes.length - 1);
            ch = margin * 2 + Math.max(...sizes.map(s => s.h));
        }

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (mergeBg !== "transparent") {
            ctx.fillStyle = mergeBg;
            ctx.fillRect(0, 0, cw, ch);
        }

        // 单图圆角：仅 each 模式生效（whole 模式在最后统一裁剪整图）
        const perImageRadius = mergeRadiusMode === "each" ? radius : 0;
        const drawRounded = (img, x, y, w, h) => {
            if (perImageRadius <= 0) {
                ctx.drawImage(img, x, y, w, h);
                return;
            }
            const r = Math.min(perImageRadius, w / 2, h / 2);
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
            else ctx.rect(x, y, w, h);
            ctx.clip();
            ctx.drawImage(img, x, y, w, h);
            ctx.restore();
        };

        let pos = margin;
        for (const s of sizes) {
            if (vertical) {
                const x = margin + Math.round((cw - margin * 2 - s.w) / 2);   // 居中
                drawRounded(s.img, x, pos, s.w, s.h);
                pos += s.h + gap;
            } else {
                const y = margin + Math.round((ch - margin * 2 - s.h) / 2);
                drawRounded(s.img, pos, y, s.w, s.h);
                pos += s.w + gap;
            }
        }
        // 整图圆角模式：先在离屏画布正常拼好，再一次性裁剪出整图圆角
        if (mergeRadiusMode === "whole" && radius > 0) {
            const r = Math.min(radius, cw / 2, ch / 2);
            const clipped = document.createElement("canvas");
            clipped.width = cw;
            clipped.height = ch;
            const cctx = clipped.getContext("2d");
            cctx.beginPath();
            if (cctx.roundRect) cctx.roundRect(0, 0, cw, ch, r);
            else cctx.rect(0, 0, cw, ch);
            cctx.clip();
            cctx.drawImage(canvas, 0, 0);
            return { canvas: clipped, cw, ch };
        }
        return { canvas, cw, ch };
    }

    // 实时预览：直接把拼接结果绘制到页面上的预览 canvas（无图片编码，GPU 合成），
    // rAF 合帧——滑条拖动过程中每帧重绘，松手也无延迟。保存时才做 PNG 编码。
    let mergePreviewDirty = false;
    let mergePreviewRaf = 0;
    const mergePreviewCanvas = document.getElementById("canvas-merge-out");

    function renderMergePreviewNow() {
        mergePreviewRaf = 0;
        if (!mergePreviewDirty) return;
        mergePreviewDirty = false;
        if (mergeFiles.length < 2) {
            hideMergeResult();
            return;
        }
        try {
            const { canvas, cw, ch } = buildMergeCanvas();
            // 预览 canvas 尺寸设为成品尺寸（CSS 负责缩放显示），直接像素拷贝
            mergePreviewCanvas.width = cw;
            mergePreviewCanvas.height = ch;
            mergePreviewCanvas.getContext("2d").drawImage(canvas, 0, 0);
            mergePreviewCanvas.hidden = false;
            document.getElementById("merge-empty-out").hidden = true;
            document.getElementById("card-merge-result").style.display = "block";
            const dirText = mergeDirection === "v" ? "竖向" : "横向";
            const unifyText = mergeUnify === "min" ? "最小化对齐" : (mergeUnify === "max" ? "最大化对齐" : "原始尺寸");
            document.getElementById("txt-merge-summary").textContent =
                `${dirText} ${mergeFiles.length} 张 | ${unifyText} | 成品 ${cw}x${ch}`;
        } catch (err) { /* 预览失败静默，保存时再报 */ }
    }

    function scheduleMergePreview() {
        mergePreviewDirty = true;
        if (!mergePreviewRaf) {
            mergePreviewRaf = requestAnimationFrame(renderMergePreviewNow);
        }
    }

    function hideMergeResult() {
        mergePreviewCanvas.hidden = true;
        document.getElementById("merge-empty-out").hidden = false;
        document.getElementById("card-merge-result").style.display = "none";
    }

    // 保存：点按钮时才生成最终高清 PNG
    document.getElementById("btn-merge-download").addEventListener("click", () => {
        if (mergeFiles.length < 2) {
            alert("请至少选择 2 张图片进行拼接");
            return;
        }
        try {
            const { canvas } = buildMergeCanvas();
            canvas.toBlob(blob => {
                if (!blob) {
                    alert("拼接导出失败");
                    return;
                }
                if (mergeResultUrl) URL.revokeObjectURL(mergeResultUrl);
                mergeResultBlob = blob;
                mergeResultUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
                a.href = mergeResultUrl;
                a.download = `merged_${stamp}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, "image/png");
        } catch (err) {
            alert("拼接失败: " + err.message);
        }
    });

    // 8.3.0a 网格拼接：布局预设 + 间距/外边框/圆角/背景 + 裁切方式 + 输出宽度（实时预览）
    const boxGm = document.getElementById("box-gm-upload");
    const inputGm = document.getElementById("input-gm-image");
    let gmFiles = [];            // [{ file, img, w, h }] 按填入顺序
    let gmBg = "#FFFFFF";
    let gmFit = "cover";         // cover=填满裁切 contain=完整留白
    let gmPreviewCanvas = document.getElementById("canvas-gm-out");

    boxGm.addEventListener("click", () => inputGm.click());
    enableDropUpload(boxGm, inputGm);

    document.querySelectorAll("#gm-bg-group .merge-bg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#gm-bg-group .merge-bg-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gmBg = btn.getAttribute("data-bg");
            scheduleGmPreview();
        });
    });
    document.querySelectorAll("#gm-fit-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#gm-fit-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gmFit = btn.getAttribute("data-fit");
            scheduleGmPreview();
        });
    });

    const gmSliders = {
        gap:    document.getElementById("gm-slider-gap"),
        margin: document.getElementById("gm-slider-margin"),
        radius: document.getElementById("gm-slider-radius")
    };
    function refreshGmVals() {
        document.getElementById("gm-val-gap").textContent = gmSliders.gap.value + "px";
        document.getElementById("gm-val-margin").textContent = gmSliders.margin.value + "px";
        document.getElementById("gm-val-radius").textContent = gmSliders.radius.value + "px";
    }
    Object.values(gmSliders).forEach(s => {
        s.addEventListener("input", () => {
            refreshGmVals();
            scheduleGmPreview();
        });
    });
    document.getElementById("gm-out-width").addEventListener("input", () => scheduleGmPreview());
    refreshGmVals();

    // 布局预设：按张数分组（2~9），每个布局 = 归一化矩形数组 [x,y,w,h]（0~1），行优先对应图片顺序
    // 网格编辑器：等分（2/4/6竖/6横/8/9）+ 点击格间边线合并相邻格
    // 模型：只存"内部边是否打开"。块 = 被打开的边围出的连通区域（天然防 L 形）。
    // hEdges[r][c] = 行 r 与 r+1 之间、列 c 处的横边（r: 0..rows-2）
    // vEdges[r][c] = 列 c 与 c+1 之间、行 r 处的竖边（c: 0..cols-2）
    let gmECols = 3, gmERows = 2;
    // 线段模型：所有分割线统一记录。hSeg = 水平线（y 位置，跨 [x0,x1)），vSeg = 垂直线（x 位置，跨 [y0,y1)）。
    // 单位 = 格子（浮点）。网格等分 = 满跨线；细分 = 块内线；合并 = 删线。
    let gmHSegs = [], gmVSegs = [];
    let gmOrient = "h";
    let gmDivide = "6";
    let gmUndoStack = [];
    let gmTool = "merge";

    // 份数 → 行列
    function gmDivideDims(divide, orient) {
        const map = {
            "2":  [1, 2],
            "4":  [2, 2],
            "6":  [3, 2],
            "8":  [4, 2],
            "9":  [3, 3],
            "16": [4, 4]
        };
        let [a, b] = map[divide] || map["6"];
        if (a !== b) {
            if (orient === "h") return { cols: Math.max(a, b), rows: Math.min(a, b) };
            return { cols: Math.min(a, b), rows: Math.max(a, b) };
        }
        return { cols: a, rows: b };
    }

    function gmSnapshot() {
        return {
            cols: gmECols, rows: gmERows,
            h: gmHSegs.map(s => ({ ...s })),
            v: gmVSegs.map(s => ({ ...s }))
        };
    }

    function gmEditorReset(cols, rows) {
        gmECols = cols; gmERows = rows;
        // 初始化：等分网格线（满跨）
        gmHSegs = [];
        gmVSegs = [];
        for (let r = 1; r < rows; r++) gmHSegs.push({ pos: r, x0: 0, x1: cols });
        for (let c = 1; c < cols; c++) gmVSegs.push({ pos: c, y0: 0, y1: rows });
        gmUndoStack = [];
        renderGmEditor();
        refreshGmBadge();
        scheduleGmPreview();
    }

    // 线段模型 → 连通区域（支持 L 形）：
    // ① 收集所有线段位置构成"精细网格"（含细分的 0.5 格等非整数位置）
    // ② 精细格之间若无线段相隔则连通（BFS 合并）
    // ③ 连通区域 = 一组精细格（可能 L 形），记录包围盒 + 格子列表
    function gmFineGrid() {
        const xsSet = [0, gmECols], ysSet = [0, gmERows];
        for (const s of gmVSegs) { xsSet.push(s.pos); }
        for (const s of gmHSegs) { ysSet.push(s.pos); }
        const xs = [...new Set(xsSet.map(v => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
        const ys = [...new Set(ysSet.map(v => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
        return { xs, ys };
    }

    // 精细格 (ci, ri) 与右侧格之间是否有竖线
    function gmHasVCut(x, y0, y1) {
        const EPS = 1e-6;
        return gmVSegs.some(s => Math.abs(s.pos - x) < EPS && s.y0 < y1 - EPS && s.y1 > y0 + EPS);
    }
    function gmHasHCut(y, x0, x1) {
        const EPS = 1e-6;
        return gmHSegs.some(s => Math.abs(s.pos - y) < EPS && s.x0 < x1 - EPS && s.x1 > x0 + EPS);
    }

    function gmEditorLeaves() {
        const { xs, ys } = gmFineGrid();
        const NC = xs.length - 1, NR = ys.length - 1;   // 精细格列行数
        const owner = Array.from({ length: NR }, () => Array(NC).fill(-1));
        const regions = [];
        for (let r = 0; r < NR; r++) {
            for (let c = 0; c < NC; c++) {
                if (owner[r][c] >= 0) continue;
                const id = regions.length;
                const cells = [];
                const q = [[r, c]];
                owner[r][c] = id;
                while (q.length) {
                    const [cr, cc] = q.pop();
                    cells.push({ cx0: xs[cc], cy0: ys[cr], cx1: xs[cc + 1], cy1: ys[cr + 1] });
                    // 四方向连通：无相隔线段才通
                    if (cc > 0 && owner[cr][cc - 1] < 0 && !gmHasVCut(xs[cc], ys[cr], ys[cr + 1])) {
                        owner[cr][cc - 1] = id; q.push([cr, cc - 1]);
                    }
                    if (cc < NC - 1 && owner[cr][cc + 1] < 0 && !gmHasVCut(xs[cc + 1], ys[cr], ys[cr + 1])) {
                        owner[cr][cc + 1] = id; q.push([cr, cc + 1]);
                    }
                    if (cr > 0 && owner[cr - 1][cc] < 0 && !gmHasHCut(ys[cr], xs[cc], xs[cc + 1])) {
                        owner[cr - 1][cc] = id; q.push([cr - 1, cc]);
                    }
                    if (cr < NR - 1 && owner[cr + 1][cc] < 0 && !gmHasHCut(ys[cr + 1], xs[cc], xs[cc + 1])) {
                        owner[cr + 1][cc] = id; q.push([cr + 1, cc]);
                    }
                }
                // 包围盒
                let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
                cells.forEach(cl => {
                    bx0 = Math.min(bx0, cl.cx0); by0 = Math.min(by0, cl.cy0);
                    bx1 = Math.max(bx1, cl.cx1); by1 = Math.max(by1, cl.cy1);
                });
                regions.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, cells });
            }
        }
        return regions;
    }

    // 细分：叶子区域包围盒内加 n-1 条线（L 形块按包围盒切）
    function gmSplitLeaf(leaf, dir, n) {
        gmUndoStack.push(gmSnapshot());
        if (dir === "h") {
            for (let k = 1; k < n; k++) {
                gmHSegs.push({ pos: leaf.y0 + (leaf.y1 - leaf.y0) * k / n, x0: leaf.x0, x1: leaf.x1 });
            }
        } else {
            for (let k = 1; k < n; k++) {
                gmVSegs.push({ pos: leaf.x0 + (leaf.x1 - leaf.x0) * k / n, y0: leaf.y0, y1: leaf.y1 });
            }
        }
        renderGmEditor();
        refreshGmBadge();
        scheduleGmPreview();
    }

    // 渲染编辑器：
    // 合并模式 = 点线段合并（渲染所有现存线段为可点线条，点击=抠掉该段跨度）
    // 细分模式 = 点块弹菜单
    function renderGmEditor() {
        const grid = document.getElementById("gm-editor-grid");
        grid.innerHTML = "";
        grid.classList.toggle("split-mode", gmTool === "split");
        const leaves = gmEditorLeaves();
        // 区域轮廓。矩形区域（cells 铺满包围盒）= 整块圆角卡片样式（旧版观感）；
        // L 形区域 = 逐格外边界描边（无底色，避免叠加缝）。
        const isRect = B => {
            const area = B.cells.reduce((s, c) => s + (c.cx1 - c.cx0) * (c.cy1 - c.cy0), 0);
            const box = (B.x1 - B.x0) * (B.y1 - B.y0);
            return Math.abs(area - box) < 1e-6;
        };
        leaves.forEach(B => {
            if (isRect(B)) {
                // 矩形块：单个圆角卡片
                const card = document.createElement("div");
                card.className = "gm-block-card";
                card.style.left = (B.x0 / gmECols * 100) + "%";
                card.style.top = (B.y0 / gmERows * 100) + "%";
                card.style.width = ((B.x1 - B.x0) / gmECols * 100) + "%";
                card.style.height = ((B.y1 - B.y0) / gmERows * 100) + "%";
                grid.appendChild(card);
            } else {
                // L 形块：逐格描外边界
                B.cells.forEach(cl => {
                    const overlap = (a, b) => a.cx0 < b.cx1 - 1e-6 && a.cx1 > b.cx0 + 1e-6;   // x 区间重叠
                    const overlapY = (a, b) => a.cy0 < b.cy1 - 1e-6 && a.cy1 > b.cy0 + 1e-6;
                    const hasTop = B.cells.some(o => o !== cl && Math.abs(o.cy1 - cl.cy0) < 1e-6 && overlap(o, cl));
                    const hasBottom = B.cells.some(o => o !== cl && Math.abs(o.cy0 - cl.cy1) < 1e-6 && overlap(o, cl));
                    const hasLeft = B.cells.some(o => o !== cl && Math.abs(o.cx1 - cl.cx0) < 1e-6 && overlapY(o, cl));
                    const hasRight = B.cells.some(o => o !== cl && Math.abs(o.cx0 - cl.cx1) < 1e-6 && overlapY(o, cl));
                    const out = document.createElement("div");
                    out.className = "gm-block-outline";
                    out.style.left = (cl.cx0 / gmECols * 100) + "%";
                    out.style.top = (cl.cy0 / gmERows * 100) + "%";
                    out.style.width = ((cl.cx1 - cl.cx0) / gmECols * 100) + "%";
                    out.style.height = ((cl.cy1 - cl.cy0) / gmERows * 100) + "%";
                    out.style.borderTopWidth = hasTop ? "0" : "";
                    out.style.borderBottomWidth = hasBottom ? "0" : "";
                    out.style.borderLeftWidth = hasLeft ? "0" : "";
                    out.style.borderRightWidth = hasRight ? "0" : "";
                    grid.appendChild(out);
                });
            }
            if (gmTool === "split") {
                const hit = document.createElement("div");
                hit.className = "gm-block-hit";
                hit.style.left = (B.x0 / gmECols * 100) + "%";
                hit.style.top = (B.y0 / gmERows * 100) + "%";
                hit.style.width = ((B.x1 - B.x0) / gmECols * 100) + "%";
                hit.style.height = ((B.y1 - B.y0) / gmERows * 100) + "%";
                hit.addEventListener("click", (e) => {
                    e.stopPropagation();
                    showGmSplitPop(e, B);
                });
                grid.appendChild(hit);
            }
        });
        // 合并模式：线段按精细格边界拆成小段渲染，点哪段删哪段（不会整条越界合并）
        if (gmTool === "merge") {
            const { xs, ys } = gmFineGrid();
            // 横线：按 x 边界拆段
            for (const s of gmHSegs) {
                const cuts = xs.filter(x => x > s.x0 + 1e-6 && x < s.x1 - 1e-6);
                const edgesX = [s.x0, ...cuts, s.x1];
                for (let i = 0; i < edgesX.length - 1; i++) {
                    const segX0 = edgesX[i], segX1 = edgesX[i + 1];
                    const e = document.createElement("div");
                    e.className = "gm-edge gm-edge-h open";
                    e.style.left = (segX0 / gmECols * 100) + "%";
                    e.style.top = (s.pos / gmERows * 100) + "%";
                    e.style.width = ((segX1 - segX0) / gmECols * 100) + "%";
                    e.addEventListener("click", () => {
                        gmUndoStack.push(gmSnapshot());
                        // 抠掉这一小段：线段减法
                        const EPS = 1e-6;
                        const next = [];
                        for (const t of gmHSegs) {
                            if (Math.abs(t.pos - s.pos) > EPS || t.x0 >= segX1 - EPS || t.x1 <= segX0 + EPS) {
                                next.push(t);
                                continue;
                            }
                            if (t.x0 < segX0 - EPS) next.push({ pos: t.pos, x0: t.x0, x1: segX0 });
                            if (t.x1 > segX1 + EPS) next.push({ pos: t.pos, x0: segX1, x1: t.x1 });
                        }
                        gmHSegs = next;
                        renderGmEditor();
                        refreshGmBadge();
                        scheduleGmPreview();
                    });
                    grid.appendChild(e);
                }
            }
            // 竖线：按 y 边界拆段
            for (const s of gmVSegs) {
                const cuts = ys.filter(y => y > s.y0 + 1e-6 && y < s.y1 - 1e-6);
                const edgesY = [s.y0, ...cuts, s.y1];
                for (let i = 0; i < edgesY.length - 1; i++) {
                    const segY0 = edgesY[i], segY1 = edgesY[i + 1];
                    const e = document.createElement("div");
                    e.className = "gm-edge gm-edge-v open";
                    e.style.left = (s.pos / gmECols * 100) + "%";
                    e.style.top = (segY0 / gmERows * 100) + "%";
                    e.style.height = ((segY1 - segY0) / gmERows * 100) + "%";
                    e.addEventListener("click", () => {
                        gmUndoStack.push(gmSnapshot());
                        const EPS = 1e-6;
                        const next = [];
                        for (const t of gmVSegs) {
                            if (Math.abs(t.pos - s.pos) > EPS || t.y0 >= segY1 - EPS || t.y1 <= segY0 + EPS) {
                                next.push(t);
                                continue;
                            }
                            if (t.y0 < segY0 - EPS) next.push({ pos: t.pos, y0: t.y0, y1: segY0 });
                            if (t.y1 > segY1 + EPS) next.push({ pos: t.pos, y0: segY1, y1: t.y1 });
                        }
                        gmVSegs = next;
                        renderGmEditor();
                        refreshGmBadge();
                        scheduleGmPreview();
                    });
                    grid.appendChild(e);
                }
            }
        }
        hideGmSplitPop();
    }

    // 细分弹出菜单：定位到点击的叶子块下方
    function showGmSplitPop(e, leaf) {
        const pop = document.getElementById("gm-split-pop");
        const grid = document.getElementById("gm-editor-grid");
        const gRect = grid.getBoundingClientRect();
        pop.hidden = false;
        pop.style.left = Math.min(e.clientX - gRect.left, gRect.width - 240) + "px";
        pop.style.top = (e.clientY - gRect.top + 10) + "px";
        // 重建按钮（清除上一轮残留的 handler）
        pop.innerHTML = "";
        [["h2", "横切 2"], ["h3", "横切 3"], ["v2", "竖切 2"], ["v3", "竖切 3"]].forEach(([spec, label]) => {
            const btn = document.createElement("button");
            btn.className = "gm-split-btn";
            btn.textContent = label;
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                hideGmSplitPop();
                gmSplitLeaf(leaf, spec[0], parseInt(spec[1], 10));
            });
            pop.appendChild(btn);
        });
    }
    function hideGmSplitPop() {
        document.getElementById("gm-split-pop").hidden = true;
    }
    document.addEventListener("click", (e) => {
        const pop = document.getElementById("gm-split-pop");
        if (!pop.hidden && !pop.contains(e.target)) hideGmSplitPop();
    });

    // 等分切换 + 方向切换 + 撤回 + 重置
    function gmApplyDivide() {
        const d = gmDivideDims(gmDivide, gmOrient);
        gmEditorReset(d.cols, d.rows);
    }
    document.querySelectorAll("#gm-divide-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#gm-divide-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gmDivide = btn.getAttribute("data-divide");
            gmApplyDivide();
        });
    });
    document.querySelectorAll("#gm-orient-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#gm-orient-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gmOrient = btn.getAttribute("data-orient");
            gmApplyDivide();
        });
    });
    document.getElementById("btn-gm-undo").addEventListener("click", () => {
        const snap = gmUndoStack.pop();
        if (!snap) return;
        gmECols = snap.cols; gmERows = snap.rows;
        gmHSegs = snap.h;
        gmVSegs = snap.v;
        renderGmEditor();
        refreshGmBadge();
        scheduleGmPreview();
    });
    document.getElementById("btn-gm-reset").addEventListener("click", () => gmApplyDivide());
    // 编辑模式切换：合并（点线段）/ 细分（点块弹菜单）
    document.querySelectorAll("#gm-tool-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#gm-tool-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gmTool = btn.getAttribute("data-tool");
            document.getElementById("txt-gm-mode-hint").textContent =
                gmTool === "merge" ? "点击线条合并两侧（可拼 L 形）" : "点击块选择横切/竖切份数";
            renderGmEditor();
        });
    });
    gmApplyDivide();   // 默认 6 份横切（3x2）
    
    function renderGmList() {
        const listEl = document.getElementById("gm-file-list");
        listEl.innerHTML = "";
        let dragIdx = -1;
        gmFiles.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = "merge-file-item";
            row.draggable = true;
            row.addEventListener("dragstart", () => { dragIdx = i; row.classList.add("dragging"); });
            row.addEventListener("dragend", () => { row.classList.remove("dragging"); listEl.querySelectorAll(".merge-file-item").forEach(r => r.classList.remove("drag-over-top", "drag-over-bottom")); });
            row.addEventListener("dragover", (e) => {
                e.preventDefault();
                const rect = row.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                row.classList.toggle("drag-over-top", before);
                row.classList.toggle("drag-over-bottom", !before);
            });
            row.addEventListener("dragleave", () => row.classList.remove("drag-over-top", "drag-over-bottom"));
            row.addEventListener("drop", (e) => {
                e.preventDefault();
                const rect = row.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                let dst = before ? i : i + 1;
                if (dragIdx < 0 || dragIdx === dst || dragIdx === dst - 1) return;
                const [moved] = gmFiles.splice(dragIdx, 1);
                if (dst > dragIdx) dst--;
                gmFiles.splice(dst, 0, moved);
                renderGmList();
                scheduleGmPreview();
            });
            const order = document.createElement("span");
            order.className = "merge-file-order";
            order.textContent = String(i + 1);
            const name = document.createElement("span");
            name.className = "merge-file-name";
            name.textContent = `${item.file.name} (${item.w}x${item.h})`;
            const del = document.createElement("button");
            del.className = "merge-file-del";
            del.textContent = "✕";
            del.title = "移除";
            del.addEventListener("click", () => {
                gmFiles.splice(i, 1);
                renderGmList();
                refreshGmBadge();
                scheduleGmPreview();
            });
            row.appendChild(order);
            row.appendChild(name);
            row.appendChild(del);
            listEl.appendChild(row);
        });
    }

    function refreshGmBadge() {
        const badge = document.getElementById("badge-gm-info");
        const preview = document.getElementById("img-gm-preview");
        if (gmFiles.length === 0) {
            badge.style.display = "none";
            preview.removeAttribute("src");
            preview.style.display = "none";
            boxGm.querySelector(".upload-icon").style.display = "";
            boxGm.querySelector(".upload-text").style.display = "";
            boxGm.querySelector(".upload-hint").style.display = "";
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        const leaves = gmEditorLeaves();
        const cells = leaves.length;
        const layoutText = `${cells} 图拼版`;
        badge.textContent = gmFiles.length <= cells
            ? `已选 ${gmFiles.length} 张 / ${cells} 格（${layoutText}），按列表顺序填入`
            : `已选 ${gmFiles.length} 张，超出 ${cells} 格，多出的不会显示`;
        preview.src = gmFiles[0].img.src;
        preview.style.display = "block";
        boxGm.querySelector(".upload-icon").style.display = "none";
        boxGm.querySelector(".upload-text").style.display = "none";
        boxGm.querySelector(".upload-hint").style.display = "none";
    }

    inputGm.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        if (files.length === 0) return;
        inputGm.value = "";
        for (const file of files) {
            try {
                const img = await loadImage(URL.createObjectURL(file));
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) continue;
                gmFiles.push({ file, img, w, h });
            } catch (err) { /* 单张失败跳过 */ }
        }
        renderGmList();
        refreshGmBadge();
        scheduleGmPreview();
    });

    function buildGmCanvas() {
        const gap = parseInt(gmSliders.gap.value, 10);
        const margin = parseInt(gmSliders.margin.value, 10);
        const radius = parseInt(gmSliders.radius.value, 10);
        const first = gmFiles[0];

        // 布局来自网格编辑器（连通区域，支持 L 形）
        const regions = gmEditorLeaves();
        const list = gmFiles.slice(0, regions.length);

        const outW = parseInt(document.getElementById("gm-out-width").value, 10) || 0;
        const cw = outW > 0 ? outW : 960;
        const ch = Math.max(1, Math.round(cw * (first.h / first.w)));

        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (gmBg !== "transparent") {
            ctx.fillStyle = gmBg;
            ctx.fillRect(0, 0, cw, ch);
        }

        const inner = { x: margin, y: margin, w: cw - margin * 2, h: ch - margin * 2 };
        list.forEach((item, idx) => {
            const R = regions[idx];
            const bx = inner.x + R.x0 / gmECols * inner.w;
            const by = inner.y + R.y0 / gmERows * inner.h;
            const bw = (R.x1 - R.x0) / gmECols * inner.w;
            const bh = (R.y1 - R.y0) / gmERows * inner.h;
            // 裁剪路径 = 区域内所有精细格（L 形按格拼形）；每格内缩 gap/2
            ctx.save();
            ctx.beginPath();
            R.cells.forEach(cl => {
                const gx = inner.x + cl.cx0 / gmECols * inner.w + gap / 2;
                const gy = inner.y + cl.cy0 / gmERows * inner.h + gap / 2;
                const gw = (cl.cx1 - cl.cx0) / gmECols * inner.w - gap;
                const gh = (cl.cy1 - cl.cy0) / gmERows * inner.h - gap;
                const r = Math.min(radius, gw / 2, gh / 2);
                if (r > 0 && ctx.roundRect) ctx.roundRect(gx, gy, Math.max(1, gw), Math.max(1, gh), r);
                else ctx.rect(gx, gy, Math.max(1, gw), Math.max(1, gh));
            });
            ctx.clip();
            // 图片按包围盒 cover/contain（L 形裁剪只显示区域内的部分）
            if (gmFit === "cover") {
                const k = Math.max(bw / item.w, bh / item.h);
                const dw = item.w * k, dh = item.h * k;
                ctx.drawImage(item.img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
            } else {
                const k = Math.min(bw / item.w, bh / item.h);
                const dw = item.w * k, dh = item.h * k;
                ctx.drawImage(item.img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
            }
            ctx.restore();
        });
        return { canvas, cw, ch };
    }

    let gmDirty = false, gmRaf = 0;
    function scheduleGmPreview() {
        if (gmFiles.length === 0) {
            gmPreviewCanvas.hidden = true;
            document.getElementById("gm-empty-out").hidden = false;
            document.getElementById("card-gm-result").style.display = "none";
            return;
        }
        gmDirty = true;
        if (!gmRaf) gmRaf = requestAnimationFrame(() => {
            gmRaf = 0;
            if (!gmDirty) return;
            gmDirty = false;
            try {
                const { canvas, cw, ch } = buildGmCanvas();
                gmPreviewCanvas.width = cw;
                gmPreviewCanvas.height = ch;
                gmPreviewCanvas.getContext("2d").drawImage(canvas, 0, 0);
                gmPreviewCanvas.hidden = false;
                document.getElementById("gm-empty-out").hidden = true;
                document.getElementById("card-gm-result").style.display = "block";
                const layoutText = `${gmEditorLeaves().length} 图拼版`;
                document.getElementById("txt-gm-summary").textContent =
                    `${layoutText} | ${gmFit === "cover" ? "填满裁切" : "完整留白"} | 成品 ${cw}x${ch}`;
            } catch (err) { /* 预览失败静默 */ }
        });
    }

    document.getElementById("btn-gm-download").addEventListener("click", () => {
        if (gmFiles.length === 0) { alert("请先选择图片"); return; }
        try {
            const { canvas } = buildGmCanvas();
            canvas.toBlob(blob => {
                if (!blob) { alert("导出失败"); return; }
                const a = document.createElement("a");
                const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
                a.href = URL.createObjectURL(blob);
                a.download = `gridmerge_${stamp}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, "image/png");
        } catch (err) {
            alert("网格拼接失败: " + err.message);
        }
    });

    // 8.3.1 图片处理子面板切换：拼接 / 网格拼接 / 九宫格切图 / 覆盖图片
    const mergeSubPanels = {
        merge: document.getElementById("panel-merge-merge"),
        gridmerge: document.getElementById("panel-merge-gridmerge"),
        grid: document.getElementById("panel-merge-grid"),
        overlay: document.getElementById("panel-merge-overlay"),
        idphoto: document.getElementById("panel-merge-idphoto")
    };
    let mergeSubMode = "merge";
    document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeSubMode = btn.getAttribute("data-sub");
            Object.entries(mergeSubPanels).forEach(([k, p]) => { p.hidden = k !== mergeSubMode; });
        });
    });

    // 8.3.2 九宫格切图：3x3 九等分，可选先裁方正方形
    const boxGrid = document.getElementById("box-grid-upload");
    const inputGrid = document.getElementById("input-grid-image");
    let gridSourceCanvas = null;
    let gridMode = "square";
    let gridResults = [];

    boxGrid.addEventListener("click", () => inputGrid.click());
    enableDropUpload(boxGrid, inputGrid);

    document.querySelectorAll("#grid-mode-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#grid-mode-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gridMode = btn.getAttribute("data-grid-mode");
        });
    });

    inputGrid.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const preview = document.getElementById("img-grid-preview");
        try {
            const img = await loadImage(URL.createObjectURL(file));
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error("图片尺寸无效");
            gridSourceCanvas = document.createElement("canvas");
            gridSourceCanvas.width = w;
            gridSourceCanvas.height = h;
            gridSourceCanvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
            preview.src = gridSourceCanvas.toDataURL("image/jpeg", 0.95);
            preview.style.display = "block";
            boxGrid.querySelector(".upload-icon").style.display = "none";
            boxGrid.querySelector(".upload-text").style.display = "none";
            boxGrid.querySelector(".upload-hint").style.display = "none";
            clearGridResults();
            const badge = document.getElementById("badge-grid-info");
            badge.style.display = "block";
            badge.style.color = "";
            badge.textContent = `已选: ${file.name} (${w}x${h})`;
        } catch (err) {
            alert("图片加载失败: " + err.message);
        }
    });

    function clearGridResults() {
        gridResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
        gridResults = [];
        document.getElementById("grid-frame-list").innerHTML = "";
        document.getElementById("card-grid-result").style.display = "none";
        document.getElementById("txt-grid-summary").textContent = "";
    }

    function gridSourceRegion() {
        const w = gridSourceCanvas.width, h = gridSourceCanvas.height;
        if (gridMode !== "square") return { sx: 0, sy: 0, sw: w, sh: h };
        const side = Math.min(w, h);
        return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side };
    }

    document.getElementById("btn-grid-run").addEventListener("click", () => {
        if (!gridSourceCanvas) { alert("请先选择一张图片"); return; }
        clearGridResults();
        const { sx, sy, sw, sh } = gridSourceRegion();
        const cw = Math.floor(sw / 3), ch = Math.floor(sh / 3);
        let done = 0;
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const piece = document.createElement("canvas");
                piece.width = cw;
                piece.height = ch;
                piece.getContext("2d").drawImage(gridSourceCanvas, sx + c * cw, sy + r * ch, cw, ch, 0, 0, cw, ch);
                piece.toBlob(blob => {
                    const filename = `${r * 3 + c + 1}_grid_${stamp}.png`;
                    gridResults.push({ blob, url: URL.createObjectURL(blob), filename });
                    done++;
                    if (done === 9) finishGrid();
                }, "image/png");
            }
        }
    });

    function finishGrid() {
        const list = document.getElementById("grid-frame-list");
        list.innerHTML = "";
        gridResults
            .slice()
            .sort((a, b) => parseInt(a.filename) - parseInt(b.filename))
            .forEach((item) => {
                const el = document.createElement("div");
                el.className = "split-frame-item";
                el.innerHTML = `<img src="${item.url}" alt="grid" class="zoomable"><div class="split-frame-label">${parseInt(item.filename)}</div>`;
                el.querySelector("img").addEventListener("click", () => {
                    const arr = gridResults
                        .slice()
                        .sort((a, b) => parseInt(a.filename) - parseInt(b.filename))
                        .map(r => ({ url: r.url, label: r.filename }));
                    const idx = arr.findIndex(it => it.url === item.url);
                    showModal(arr, idx >= 0 ? idx : 0);
                });
                list.appendChild(el);
            });
        const w = gridSourceCanvas.width, h = gridSourceCanvas.height;
        document.getElementById("txt-grid-result-title").textContent = "#️⃣ 切图完成 (共 9 张)";
        document.getElementById("txt-grid-summary").textContent =
            gridMode === "square"
                ? `已居中裁成正方形后九等分 | 原图 ${w}x${h} → 每块 ${Math.floor(Math.min(w, h) / 3)}px`
                : `原图完整九等分（不裁剪）| ${w}x${h} → 每块 ${Math.floor(w / 3)}x${Math.floor(h / 3)}`;
        document.getElementById("card-grid-result").style.display = "block";
    }

    document.getElementById("btn-grid-download").addEventListener("click", () => {
        if (gridResults.length === 0) return;
        gridResults
            .slice()
            .sort((a, b) => parseInt(a.filename) - parseInt(b.filename))
            .forEach((r, i) => {
                setTimeout(() => {
                    const a = document.createElement("a");
                    a.href = r.url;
                    a.download = r.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }, i * 200);
            });
    });

    // 8.3.3 覆盖图片：底图 + 覆盖图/文字图层，画布拖拽/缩放/旋转
    const boxOvBase = document.getElementById("box-ov-base-upload");
    const inputOvBase = document.getElementById("input-ov-base");
    const ovWrap = document.getElementById("ov-canvas-wrap");
    const ovCanvas = document.getElementById("canvas-ov");
    const ovCtx = ovCanvas.getContext("2d");
    let ovBase = null;
    let ovLayers = [];
    let ovSelected = -1;
    let ovViewScale = 1;

    boxOvBase.addEventListener("click", () => inputOvBase.click());
    enableDropUpload(boxOvBase, inputOvBase);

    inputOvBase.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        try {
            const img = await loadImage(URL.createObjectURL(file));
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error("图片尺寸无效");
            ovBase = { img, w, h };
            ovLayers = [];
            ovSelected = -1;
            refreshOvBaseUI();
            renderOv();
        } catch (err) {
            alert("底图加载失败: " + err.message);
        }
    });

    function refreshOvBaseUI() {
        const preview = document.getElementById("img-ov-base-preview");
        const badge = document.getElementById("badge-ov-base-info");
        if (!ovBase) {
            document.getElementById("ov-hint").hidden = false;
            badge.style.display = "none";
            return;
        }
        document.getElementById("ov-hint").hidden = true;
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = `底图: ${ovBase.w}x${ovBase.h}`;
        preview.src = ovBase.img.src;
        preview.style.display = "block";
        boxOvBase.querySelector(".upload-icon").style.display = "none";
        boxOvBase.querySelector(".upload-text").style.display = "none";
        boxOvBase.querySelector(".upload-hint").style.display = "none";
    }

    function renderOv() {
        if (!ovBase) return;
        ovCanvas.width = ovBase.w;
        ovCanvas.height = ovBase.h;
        const wrapW = ovWrap.clientWidth || 320;
        ovViewScale = Math.min(1, wrapW / ovBase.w);
        ovCanvas.style.width = (ovBase.w * ovViewScale) + "px";
        ovCanvas.style.height = (ovBase.h * ovViewScale) + "px";
        ovCtx.clearRect(0, 0, ovBase.w, ovBase.h);
        ovCtx.drawImage(ovBase.img, 0, 0);
        for (let i = 0; i < ovLayers.length; i++) {
            drawOvLayer(ovLayers[i]);
        }
        renderOvHandles();
        syncOvPropsPanel();
    }

    function drawOvLayer(L) {
        ovCtx.save();
        ovCtx.globalAlpha = L.opacity;
        ovCtx.translate(L.x, L.y);
        ovCtx.rotate(L.rot * Math.PI / 180);
        if (L.kind === "image") {
            const r = Math.min(L.radius, L.w / 2, L.h / 2);
            ovCtx.beginPath();
            if (r > 0 && ovCtx.roundRect) ovCtx.roundRect(-L.w / 2, -L.h / 2, L.w, L.h, r);
            else ovCtx.rect(-L.w / 2, -L.h / 2, L.w, L.h);
            ovCtx.clip();
            ovCtx.drawImage(L.img, -L.w / 2, -L.h / 2, L.w, L.h);
            if (L.borderWidth > 0) {
                ovCtx.globalAlpha = 1;
                ovCtx.lineWidth = L.borderWidth;
                ovCtx.strokeStyle = L.borderColor;
                ovCtx.beginPath();
                if (r > 0 && ovCtx.roundRect) ovCtx.roundRect(-L.w / 2 + L.borderWidth / 2, -L.h / 2 + L.borderWidth / 2, L.w - L.borderWidth, L.h - L.borderWidth, Math.max(0, r - L.borderWidth / 2));
                else ovCtx.rect(-L.w / 2 + L.borderWidth / 2, -L.h / 2 + L.borderWidth / 2, L.w - L.borderWidth, L.h - L.borderWidth);
                ovCtx.stroke();
            }
        } else {
            ovCtx.font = `${L.italic ? "italic " : ""}${L.weight || "bold"} ${L.fontSize}px sans-serif`;
            ovCtx.textAlign = "center";
            ovCtx.textBaseline = "middle";
            if (L.stroke) {
                ovCtx.lineWidth = Math.max(2, L.fontSize / 8);
                ovCtx.strokeStyle = "rgba(0,0,0,0.85)";
                ovCtx.strokeText(L.text, 0, 0);
            }
            ovCtx.fillStyle = L.textColor;
            ovCtx.fillText(L.text, 0, 0);
            const m = ovCtx.measureText(L.text || " ");
            L.w = m.width;
            L.h = L.fontSize * 1.2;
        }
        ovCtx.restore();
    }

    const ovHandles = [];
    function renderOvHandles() {
        ovHandles.forEach(h => h.remove());
        ovHandles.length = 0;
        if (ovSelected < 0 || !ovLayers[ovSelected]) return;
        const L = ovLayers[ovSelected];
        const rect = ovCanvas.getBoundingClientRect();
        const wrapRect = ovWrap.getBoundingClientRect();
        const ox = rect.left - wrapRect.left, oy = rect.top - wrapRect.top;
        const corners = [
            [-L.w / 2, -L.h / 2], [L.w / 2, -L.h / 2],
            [L.w / 2, L.h / 2], [-L.w / 2, L.h / 2]
        ].map(([px, py]) => {
            const a = L.rot * Math.PI / 180;
            const rx = px * Math.cos(a) - py * Math.sin(a);
            const ry = px * Math.sin(a) + py * Math.cos(a);
            return [ox + (L.x + rx) * ovViewScale, oy + (L.y + ry) * ovViewScale];
        });
        const box = document.createElement("div");
        box.className = "ov-layer-box";
        const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
        box.style.left = Math.min(...xs) + "px";
        box.style.top = Math.min(...ys) + "px";
        box.style.width = (Math.max(...xs) - Math.min(...xs)) + "px";
        box.style.height = (Math.max(...ys) - Math.min(...ys)) + "px";
        ovWrap.appendChild(box);
        ovHandles.push(box);
        const mkHandle = (x, y, cls) => {
            const h = document.createElement("div");
            h.className = "ov-handle " + cls;
            h.style.left = x + "px";
            h.style.top = y + "px";
            ovWrap.appendChild(h);
            ovHandles.push(h);
            return h;
        };
        const topMid = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
        mkHandle(topMid[0], topMid[1], "rot").addEventListener("pointerdown", e => startOvGesture(e, "rotate"));
        mkHandle(corners[2][0], corners[2][1], "scale").addEventListener("pointerdown", e => startOvGesture(e, "scale"));
        if (L.kind === "image" && document.getElementById("chk-ov-free-scale").checked) {
            const rightMid = [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2];
            const bottomMid = [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2];
            mkHandle(rightMid[0], rightMid[1], "scale-x").addEventListener("pointerdown", e => startOvGesture(e, "scaleX"));
            mkHandle(bottomMid[0], bottomMid[1], "scale-y").addEventListener("pointerdown", e => startOvGesture(e, "scaleY"));
        }
    }

    function canvasToImage(e) {
        const rect = ovCanvas.getBoundingClientRect();
        return { x: (e.clientX - rect.left) / ovViewScale, y: (e.clientY - rect.top) / ovViewScale };
    }

    ovCanvas.addEventListener("pointerdown", (e) => {
        if (!ovBase) return;
        const p = canvasToImage(e);
        let hit = -1;
        for (let i = ovLayers.length - 1; i >= 0; i--) {
            const L = ovLayers[i];
            const a = -L.rot * Math.PI / 180;
            const dx = p.x - L.x, dy = p.y - L.y;
            const lx = dx * Math.cos(a) - dy * Math.sin(a);
            const ly = dx * Math.sin(a) + dy * Math.cos(a);
            if (Math.abs(lx) <= L.w / 2 + 4 && Math.abs(ly) <= L.h / 2 + 4) { hit = i; break; }
        }
        ovSelected = hit;
        renderOv();
        if (hit >= 0) startOvGesture(e, "move");
    });

    function startOvGesture(e, mode) {
        e.preventDefault();
        e.stopPropagation();
        if (ovSelected < 0 || !ovLayers[ovSelected]) return;
        const L = ovLayers[ovSelected];
        const start = canvasToImage(e);
        const s0 = { x: L.x, y: L.y, w: L.w, h: L.h, rot: L.rot, fontSize: L.fontSize };
        const onMove = (ev) => {
            const p = canvasToImage(ev);
            if (mode === "move") {
                L.x = s0.x + (p.x - start.x);
                L.y = s0.y + (p.y - start.y);
            } else if (mode === "scale") {
                if (L.kind === "text") {
                    const d0 = Math.hypot(start.x - s0.x, start.y - s0.y) || 1;
                    const d1 = Math.hypot(p.x - s0.x, p.y - s0.y);
                    const k = Math.max(0.05, d1 / d0);
                    L.fontSize = Math.max(8, Math.round(s0.fontSize * k));
                } else if (document.getElementById("chk-ov-free-scale").checked) {
                    const a = -s0.rot * Math.PI / 180;
                    const dx = p.x - s0.x, dy = p.y - s0.y;
                    const lx = dx * Math.cos(a) - dy * Math.sin(a);
                    const ly = dx * Math.sin(a) + dy * Math.cos(a);
                    L.w = Math.max(8, Math.abs(lx) * 2);
                    L.h = Math.max(8, Math.abs(ly) * 2);
                } else {
                    const d0 = Math.hypot(start.x - s0.x, start.y - s0.y) || 1;
                    const d1 = Math.hypot(p.x - s0.x, p.y - s0.y);
                    const k = Math.max(0.05, d1 / d0);
                    L.w = Math.max(8, s0.w * k);
                    L.h = Math.max(8, s0.h * k);
                }
            } else if (mode === "scaleX" || mode === "scaleY") {
                const a = -s0.rot * Math.PI / 180;
                const dx = p.x - s0.x, dy = p.y - s0.y;
                const lx = dx * Math.cos(a) - dy * Math.sin(a);
                const ly = dx * Math.sin(a) + dy * Math.cos(a);
                if (mode === "scaleX") L.w = Math.max(8, Math.abs(lx) * 2);
                else L.h = Math.max(8, Math.abs(ly) * 2);
            } else if (mode === "rotate") {
                const a0 = Math.atan2(start.y - s0.y, start.x - s0.x);
                const a1 = Math.atan2(p.y - s0.y, p.x - s0.x);
                L.rot = s0.rot + (a1 - a0) * 180 / Math.PI;
            }
            renderOv();
            syncOvSliders(L);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }

    const inputOvLayer = document.getElementById("input-ov-layer");
    const boxOvLayer = document.getElementById("box-ov-layer-upload");
    boxOvLayer.addEventListener("click", () => inputOvLayer.click());
    enableDropUpload(boxOvLayer, inputOvLayer);
    inputOvLayer.addEventListener("change", async (e) => {
        if (!ovBase) { alert("请先上传底图"); e.target.value = ""; return; }
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        let lastImg = null;
        for (const file of files) {
            try {
                const img = await loadImage(URL.createObjectURL(file));
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                if (!w || !h) continue;
                const k = Math.min(ovBase.w * 0.3 / w, ovBase.h * 0.3 / h, 1);
                ovLayers.push({
                    kind: "image", img,
                    x: ovBase.w / 2, y: ovBase.h / 2,
                    w: Math.round(w * k), h: Math.round(h * k),
                    rot: 0, opacity: 1, borderWidth: 0, borderColor: "#FFFFFF", radius: 0
                });
                ovSelected = ovLayers.length - 1;
                lastImg = img;
            } catch (err) { /* 单张失败跳过 */ }
        }
        if (lastImg) {
            const lp = document.getElementById("img-ov-layer-preview");
            lp.src = lastImg.src;
            lp.style.display = "block";
            boxOvLayer.querySelector(".upload-icon").style.display = "none";
            boxOvLayer.querySelector(".upload-text").style.display = "none";
            boxOvLayer.querySelector(".upload-hint").style.display = "none";
        }
        renderOv();
    });

    document.getElementById("btn-ov-add-text").addEventListener("click", () => {
        if (!ovBase) { alert("请先上传底图"); return; }
        ovLayers.push({
            kind: "text", text: "双击编辑文字",
            x: ovBase.w / 2, y: ovBase.h / 2,
            w: 100, h: 60, rot: 0, opacity: 1,
            fontSize: Math.max(24, Math.round(ovBase.h / 10)),
            textColor: "#FFFFFF", stroke: true,
            weight: "bold", italic: false
        });
        ovSelected = ovLayers.length - 1;
        renderOv();
    });

    document.getElementById("btn-ov-delete").addEventListener("click", () => {
        if (ovSelected < 0) { alert("请先在画布上选中一个图层"); return; }
        ovLayers.splice(ovSelected, 1);
        ovSelected = -1;
        renderOv();
    });

    ovCanvas.addEventListener("dblclick", () => {
        if (ovSelected >= 0 && ovLayers[ovSelected] && ovLayers[ovSelected].kind === "text") {
            const inp = document.getElementById("ov-text-input");
            inp.focus();
            inp.select();
        }
    });

    function syncOvPropsPanel() {
        const L = ovLayers[ovSelected];
        const card = document.getElementById("card-ov-props");
        card.style.display = L ? "block" : "none";
        if (!L) return;
        const isText = L.kind === "text";
        document.getElementById("ov-props-image").hidden = isText;
        document.getElementById("ov-props-text").hidden = !isText;
        document.getElementById("txt-ov-layer-kind").textContent =
            isText ? "（文字图层）" : `（覆盖图 ${ovSelected + 1}/${ovLayers.filter(x => x.kind === "image").length}）`;
        syncOvSliders(L);
        if (isText) document.getElementById("ov-text-input").value = L.text;
    }

    function syncOvSliders(L) {
        if (!L) return;
        if (L.kind === "image") {
            const pct = Math.round(L.w / ovBase.w * 1000) / 10;
            const pctH = Math.round(L.h / ovBase.h * 1000) / 10;
            const freeScale = document.getElementById("chk-ov-free-scale").checked;
            document.getElementById("ov-slider-opacity").value = L.opacity;
            document.getElementById("ov-slider-width").value = Math.min(100, pct);
            document.getElementById("ov-slider-rotate").value = Math.round(L.rot);
            document.getElementById("ov-slider-border").value = L.borderWidth;
            document.getElementById("ov-slider-radius").value = L.radius;
            const hSlider = document.getElementById("ov-slider-height");
            hSlider.disabled = !freeScale;
            hSlider.value = Math.min(100, pctH);
            document.getElementById("ov-val-opacity").textContent = Math.round(L.opacity * 100) + "%";
            document.getElementById("ov-val-width").textContent = pct + "%";
            document.getElementById("ov-val-height").textContent = pctH + "%";
            document.getElementById("ov-val-rotate").textContent = Math.round(L.rot) + "°";
            document.getElementById("ov-val-border").textContent = L.borderWidth + "px";
            document.getElementById("ov-val-radius").textContent = L.radius + "px";
            document.getElementById("ov-border-color").value = L.borderColor;
            syncOvPxInputs(L);
        } else {
            document.getElementById("ov-slider-t-opacity").value = L.opacity;
            document.getElementById("ov-slider-t-size").value = L.fontSize;
            document.getElementById("ov-slider-t-rotate").value = Math.round(L.rot);
            document.getElementById("ov-val-t-opacity").textContent = Math.round(L.opacity * 100) + "%";
            document.getElementById("ov-val-t-size").textContent = L.fontSize + "px";
            document.getElementById("ov-val-t-rotate").textContent = Math.round(L.rot) + "°";
            document.getElementById("ov-text-color").value = L.textColor;
            document.getElementById("chk-ov-text-stroke").checked = !!L.stroke;
            document.getElementById("chk-ov-text-italic").checked = !!L.italic;
            document.querySelectorAll("#ov-text-weight-group .segmented-btn").forEach(b => {
                b.classList.toggle("active", b.getAttribute("data-weight") === (L.weight || "bold"));
            });
        }
    }

    function ovProp(getL, apply) {
        return () => {
            const L = getL();
            if (!L) return;
            apply(L);
            renderOv();
        };
    }
    const selImage = () => (ovSelected >= 0 && ovLayers[ovSelected] && ovLayers[ovSelected].kind === "image") ? ovLayers[ovSelected] : null;
    const selText = () => (ovSelected >= 0 && ovLayers[ovSelected] && ovLayers[ovSelected].kind === "text") ? ovLayers[ovSelected] : null;

    document.getElementById("ov-slider-opacity").addEventListener("input", ovProp(selImage, L => L.opacity = parseFloat(document.getElementById("ov-slider-opacity").value)));
    document.getElementById("ov-slider-width").addEventListener("input", ovProp(selImage, L => {
        const pct = parseFloat(document.getElementById("ov-slider-width").value);
        const w = ovBase.w * pct / 100;
        if (!document.getElementById("chk-ov-free-scale").checked) {
            const k = w / L.w;
            L.h = Math.max(8, L.h * k);
        }
        L.w = w;
    }));
    const ovHeightSlider = document.getElementById("ov-slider-height");
    ovHeightSlider.addEventListener("input", ovProp(selImage, L => {
        if (!document.getElementById("chk-ov-free-scale").checked) return;
        L.h = Math.max(8, ovBase.h * parseFloat(ovHeightSlider.value) / 100);
    }));
    document.getElementById("chk-ov-free-scale").addEventListener("change", () => {
        const L = selImage();
        if (!L || !L.img) return;
        if (!document.getElementById("chk-ov-free-scale").checked) {
            const ratio = L.img.naturalHeight / L.img.naturalWidth;
            L.h = Math.max(8, Math.round(L.w * ratio));
        }
        renderOv();
        syncOvSliders(L);
    });
    document.getElementById("btn-ov-fit-base").addEventListener("click", () => {
        const L = selImage();
        if (!L) { alert("请先选中一个覆盖图"); return; }
        L.w = ovBase.w;
        L.h = ovBase.h;
        L.x = ovBase.w / 2;
        L.y = ovBase.h / 2;
        renderOv();
    });
    function syncOvPxInputs(L) {
        if (!L || L.kind !== "image") return;
        document.getElementById("ov-px-width").value = Math.round(L.w);
        document.getElementById("ov-px-height").value = Math.round(L.h);
    }
    document.getElementById("btn-ov-apply-px").addEventListener("click", () => {
        const L = selImage();
        if (!L) { alert("请先选中一个覆盖图"); return; }
        let w = parseInt(document.getElementById("ov-px-width").value, 10);
        let h = parseInt(document.getElementById("ov-px-height").value, 10);
        const free = document.getElementById("chk-ov-free-scale").checked;
        if (isNaN(w) && !isNaN(h)) w = free ? L.w : Math.max(1, Math.round(L.w * h / L.h));
        if (isNaN(h) && !isNaN(w)) h = free ? L.h : Math.max(1, Math.round(L.h * w / L.w));
        if (isNaN(w) || isNaN(h)) { alert("请至少填写宽度或高度其中一个像素值"); return; }
        L.w = Math.max(1, w);
        L.h = Math.max(1, h);
        renderOv();
    });
    document.getElementById("ov-slider-rotate").addEventListener("input", ovProp(selImage, L => L.rot = parseInt(document.getElementById("ov-slider-rotate").value, 10)));
    document.getElementById("ov-slider-border").addEventListener("input", ovProp(selImage, L => L.borderWidth = parseInt(document.getElementById("ov-slider-border").value, 10)));
    document.getElementById("ov-slider-radius").addEventListener("input", ovProp(selImage, L => L.radius = parseInt(document.getElementById("ov-slider-radius").value, 10)));
    document.getElementById("ov-border-color").addEventListener("input", ovProp(selImage, L => L.borderColor = document.getElementById("ov-border-color").value));

    document.getElementById("ov-text-input").addEventListener("input", ovProp(selText, L => L.text = document.getElementById("ov-text-input").value || " "));
    document.getElementById("ov-slider-t-opacity").addEventListener("input", ovProp(selText, L => L.opacity = parseFloat(document.getElementById("ov-slider-t-opacity").value)));
    document.getElementById("ov-slider-t-size").addEventListener("input", ovProp(selText, L => L.fontSize = parseInt(document.getElementById("ov-slider-t-size").value, 10)));
    document.getElementById("ov-slider-t-rotate").addEventListener("input", ovProp(selText, L => L.rot = parseInt(document.getElementById("ov-slider-t-rotate").value, 10)));
    document.getElementById("ov-text-color").addEventListener("input", ovProp(selText, L => L.textColor = document.getElementById("ov-text-color").value));
    document.getElementById("chk-ov-text-stroke").addEventListener("change", ovProp(selText, L => L.stroke = document.getElementById("chk-ov-text-stroke").checked));
    document.getElementById("chk-ov-text-italic").addEventListener("change", ovProp(selText, L => L.italic = document.getElementById("chk-ov-text-italic").checked));
    document.querySelectorAll("#ov-text-weight-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#ov-text-weight-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const L = selText();
            if (!L) return;
            L.weight = btn.getAttribute("data-weight");
            renderOv();
        });
    });

    document.getElementById("btn-ov-download").addEventListener("click", () => {
        if (!ovBase) { alert("请先上传底图"); return; }
        const keep = ovSelected;
        ovSelected = -1;
        renderOv();
        ovCanvas.toBlob(blob => {
            ovSelected = keep;
            renderOv();
            if (!blob) { alert("导出失败"); return; }
            const a = document.createElement("a");
            const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
            a.href = URL.createObjectURL(blob);
            a.download = `overlay_${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            document.getElementById("txt-ov-summary").textContent =
                `已导出 ${ovBase.w}x${ovBase.h} 成品（${ovLayers.length} 个图层）| ${(blob.size / 1024).toFixed(1)} KB`;
        }, "image/png");
    });

    window.addEventListener("resize", () => {
        if (ovBase) renderOv();
    });

    // 8.4 相片处理：标准证件照制作（1寸/2寸系列 + 底色 + 5寸相纸排版）
    // 尺寸标准：300DPI 换算（mm ÷ 25.4 × 300），行业通识规格
    const IDP_SIZES = {
        "1":  { label: "1 寸",   mm: "25×35mm",   w: 295, h: 413 },
        "s1": { label: "小 1 寸", mm: "22×32mm",   w: 260, h: 378 },
        "b1": { label: "大 1 寸", mm: "33×48mm",   w: 390, h: 567 },
        "2":  { label: "2 寸",   mm: "35×49mm",   w: 413, h: 579 },
        "s2": { label: "小 2 寸", mm: "35×45mm",   w: 413, h: 531 },
        "b2": { label: "大 2 寸", mm: "35×53mm",   w: 413, h: 626 }
    };
    const IDP_SHEET = { w: 1500, h: 1050 };   // 5寸相纸（300DPI 12.7×8.9cm 横放）

    const boxIdp = document.getElementById("box-idp-upload");
    const inputIdp = document.getElementById("input-idp-image");
    let idpSource = null;        // { img, w, h }
    let idpSizeKey = "1";
    let idpBg = "#FFFFFF";
    let idpScale = 1, idpDx = 0, idpDy = 0;
    const idpCanvas = document.getElementById("canvas-idp-out");

    boxIdp.addEventListener("click", () => inputIdp.click());
    enableDropUpload(boxIdp, inputIdp);

    inputIdp.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        try {
            const img = await loadImage(URL.createObjectURL(file));
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error("图片尺寸无效");
            idpSource = { img, w, h };
            // 初始缩放：按证件照高度容纳人像主体（取图高的 75% 为人像参考）→ 让头部约占 2/3
            idpScale = 1; idpDx = 0; idpDy = 0;
            syncIdpSliders();
            const preview = document.getElementById("img-idp-preview");
            preview.src = idpSource.img.src;
            preview.style.display = "block";
            boxIdp.querySelector(".upload-icon").style.display = "none";
            boxIdp.querySelector(".upload-text").style.display = "none";
            boxIdp.querySelector(".upload-hint").style.display = "none";
            const badge = document.getElementById("badge-idp-info");
            badge.style.display = "block";
            badge.style.color = "";
            badge.textContent = `已选: ${file.name} (${w}x${h})`;
            renderIdp();
        } catch (err) {
            alert("图片加载失败: " + err.message);
        }
    });

    document.querySelectorAll("#idp-size-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#idp-size-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            idpSizeKey = btn.getAttribute("data-size");
            const s = IDP_SIZES[idpSizeKey];
            document.getElementById("txt-idp-size-info").textContent = `${s.mm} · ${s.w}×${s.h}px · 300DPI`;
            renderIdp();
        });
    });
    document.querySelectorAll("#idp-bg-group .merge-bg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#idp-bg-group .merge-bg-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            idpBg = btn.getAttribute("data-bg");
            renderIdp();
        });
    });

    const idpSliders = {
        scale: document.getElementById("idp-slider-scale"),
        x: document.getElementById("idp-slider-x"),
        y: document.getElementById("idp-slider-y")
    };
    function syncIdpSliders() {
        idpSliders.scale.value = idpScale;
        idpSliders.x.value = idpDx;
        idpSliders.y.value = idpDy;
        document.getElementById("idp-val-scale").textContent = Math.round(idpScale * 100) + "%";
        document.getElementById("idp-val-x").textContent = (idpDx >= 0 ? "+" : "") + Math.round(idpDx * 100);
        document.getElementById("idp-val-y").textContent = (idpDy >= 0 ? "+" : "") + Math.round(idpDy * 100);
    }
    idpSliders.scale.addEventListener("input", () => { idpScale = parseFloat(idpSliders.scale.value); syncIdpSliders(); renderIdp(); });
    idpSliders.x.addEventListener("input", () => { idpDx = parseFloat(idpSliders.x.value); syncIdpSliders(); renderIdp(); });
    idpSliders.y.addEventListener("input", () => { idpDy = parseFloat(idpSliders.y.value); syncIdpSliders(); renderIdp(); });

    // 核心：源图 → 证件照画布。源图按高度适配画布（scale=1 时图高 = 画布高 × 4/3，
    // 标准证件照构图：头顶留白少量、人像占满），dx/dy 为偏移比例。
    function buildIdpCanvas() {
        const s = IDP_SIZES[idpSizeKey];
        const canvas = document.createElement("canvas");
        canvas.width = s.w;
        canvas.height = s.h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = idpBg;
        ctx.fillRect(0, 0, s.w, s.h);
        if (idpSource) {
            const baseK = (s.h * 4 / 3) / idpSource.h;
            const k = baseK * idpScale;
            const dw = idpSource.w * k, dh = idpSource.h * k;
            // 居中 + 偏移；默认垂直略上移（脸部在上半）
            const cx = (s.w - dw) / 2 + idpDx * s.w;
            const cy = (s.h - dh) / 2 - dh * 0.08 + idpDy * s.h;
            ctx.drawImage(idpSource.img, cx, cy, dw, dh);
        }
        return { canvas, w: s.w, h: s.h, size: s };
    }

    function renderIdp() {
        if (!idpSource) {
            document.getElementById("card-idp-result").style.display = "none";
            return;
        }
        const { canvas, w, h, size } = buildIdpCanvas();
        idpCanvas.width = w;
        idpCanvas.height = h;
        idpCanvas.getContext("2d").drawImage(canvas, 0, 0);
        idpCanvas.hidden = false;
        document.getElementById("card-idp-result").style.display = "block";
        document.getElementById("txt-idp-summary").textContent =
            `${size.label} · ${size.mm} · ${w}×${h}px（300DPI）`;
    }

    document.getElementById("btn-idp-download").addEventListener("click", () => {
        if (!idpSource) { alert("请先上传照片"); return; }
        const { canvas, size } = buildIdpCanvas();
        canvas.toBlob(blob => {
            if (!blob) { alert("导出失败"); return; }
            const a = document.createElement("a");
            const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
            a.href = URL.createObjectURL(blob);
            a.download = `idphoto_${size.label.replace(/\s/g, "")}_${stamp}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, "image/jpeg", 0.95);
    });

    // 5 寸相纸排版：1 寸系列一版 8 张（4列×2行）、2 寸系列一版 4 张（2×2），带裁切留白
    document.getElementById("btn-idp-download-sheet").addEventListener("click", () => {
        if (!idpSource) { alert("请先上传照片"); return; }
        const { canvas } = buildIdpCanvas();
        const s = IDP_SIZES[idpSizeKey];
        const isOneInch = s.h <= 531;   // 1寸系列（高 ≤531）
        const cols = isOneInch ? 4 : 2;
        const rows = isOneInch ? 2 : 2;
        const gapX = 30, gapY = 30, edge = 40;
        const sheet = document.createElement("canvas");
        sheet.width = IDP_SHEET.w;
        sheet.height = IDP_SHEET.h;
        const sctx = sheet.getContext("2d");
        sctx.fillStyle = "#FFFFFF";
        sctx.fillRect(0, 0, sheet.width, sheet.height);
        const totalW = cols * s.w + (cols - 1) * gapX;
        const totalH = rows * s.h + (rows - 1) * gapY;
        const startX = (sheet.width - totalW) / 2;
        const startY = (sheet.height - totalH) / 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                sctx.drawImage(canvas, startX + c * (s.w + gapX), startY + r * (s.h + gapY));
            }
        }
        sheet.toBlob(blob => {
            if (!blob) { alert("导出失败"); return; }
            const a = document.createElement("a");
            const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
            a.href = URL.createObjectURL(blob);
            a.download = `idphoto_sheet_${isOneInch ? "1inchx8" : "2inchx4"}_${stamp}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, "image/jpeg", 0.95);
    });

    // 8.5 MD5 工具：多文件哈希读取 + 追加字节批量修改
    // 数据模型：md5Items = [{ file, name, size, bytes(Uint8Array), hashes }]，逐项独立展示
    const boxMd5 = document.getElementById("box-md5-upload");
    const inputMd5 = document.getElementById("input-md5-file");
    let md5Items = [];

    boxMd5.addEventListener("click", () => inputMd5.click());
    enableDropUpload(boxMd5, inputMd5);

    // 五种哈希：MD5 自实现（RFC 1321），SHA 系列走 Web Crypto
    const MD5_ALGOS = [
        ["MD5", null],
        ["SHA1", "SHA-1"],
        ["SHA256", "SHA-256"],
        ["SHA384", "SHA-384"],
        ["SHA512", "SHA-512"]
    ];

    // MD5 纯 JS 实现（RFC 1321）
    async function md5Hash(bytes) {
        const rl = (v, s) => (v << s) | (v >>> (32 - s));
        const toHex = (num) => {
            let s = "";
            for (let i = 0; i < 4; i++) s += ((num >> (i * 8)) & 0xFF).toString(16).padStart(2, "0");
            return s;
        };
        const len = bytes.length;
        const bitLen = len * 8;
        const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
        padded.set(bytes);
        padded[len] = 0x80;
        const dv = new DataView(padded.buffer);
        dv.setUint32(padded.length - 8, bitLen >>> 0, true);
        dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);
        const K = new Uint32Array(64);
        for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
        const S = [7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
                   5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
                   4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
                   6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21];
        let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
        for (let chunk = 0; chunk < padded.length; chunk += 64) {
            const M = new Uint32Array(16);
            for (let i = 0; i < 16; i++) M[i] = dv.getUint32(chunk + i * 4, true);
            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16)      { F = (B & C) | (~B & D);      g = i; }
                else if (i < 32) { F = (D & B) | (~D & C);      g = (5 * i + 1) % 16; }
                else if (i < 48) { F = B ^ C ^ D;               g = (3 * i + 5) % 16; }
                else             { F = C ^ (B | ~D);            g = (7 * i) % 16; }
                F = (F + A + K[i] + M[g]) >>> 0;
                A = D; D = C; C = B;
                B = (B + rl(F, S[i])) >>> 0;
            }
            a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
        }
        return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
    }

    async function computeMd5Hashes(bytes) {
        const out = {};
        for (const [name, algo] of MD5_ALGOS) {
            try {
                if (algo === null) {
                    out[name] = (await md5Hash(bytes)).toUpperCase();
                } else {
                    const buf = await crypto.subtle.digest(algo, bytes);
                    out[name] = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
                }
            } catch (e) {
                out[name] = "计算失败";
            }
        }
        return out;
    }

    // 渲染文件列表：文件名 + MD5（主展示）+ 五哈希折叠明细 + 单条复制 + 删除
    function renderMd5List() {
        const box = document.getElementById("txt-md5-hashes");
        const actions = document.getElementById("md5-read-actions");
        box.style.display = md5Items.length ? "block" : "none";
        actions.style.display = md5Items.length ? "flex" : "none";
        box.innerHTML = "";
        md5Items.forEach((item, i) => {
            const block = document.createElement("div");
            block.className = "md5-item";
            // 头行：序号 + 文件名 + 大小 + 删除
            const head = document.createElement("div");
            head.className = "md5-item-head";
            head.innerHTML = `<span class="md5-hash-name">${i + 1}. ${item.name}</span> <span style="color: var(--text-faint);">(${(item.size / 1024).toFixed(1)} KB)</span>`;
            const del = document.createElement("button");
            del.className = "md5-item-del";
            del.textContent = "✕";
            del.title = "移除";
            del.addEventListener("click", () => {
                md5Items.splice(i, 1);
                renderMd5List();
                refreshMd5Badge();
            });
            head.appendChild(del);
            block.appendChild(head);
            // MD5 主行 + 复制按钮
            const md5Row = document.createElement("div");
            md5Row.className = "md5-item-row";
            md5Row.innerHTML = `<span class="md5-hash-name">MD5</span>: ${item.hashes.MD5}`;
            const copyMd5 = document.createElement("button");
            copyMd5.className = "md5-item-del";
            copyMd5.textContent = "📋";
            copyMd5.title = "复制 MD5";
            copyMd5.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(item.hashes.MD5);
                    copyMd5.textContent = "✓";
                    setTimeout(() => { copyMd5.textContent = "📋"; }, 1200);
                } catch (e) {
                    alert(item.hashes.MD5);
                }
            });
            md5Row.appendChild(copyMd5);
            block.appendChild(md5Row);
            // 明细折叠（其余四种哈希）
            const detail = document.createElement("div");
            detail.className = "md5-item-detail";
            detail.style.display = "none";
            for (const [name, val] of Object.entries(item.hashes)) {
                if (name === "MD5") continue;
                const row = document.createElement("div");
                row.innerHTML = `<span class="md5-hash-name">${name}</span>: ${val}`;
                detail.appendChild(row);
            }
            const toggle = document.createElement("button");
            toggle.className = "md5-item-toggle";
            toggle.textContent = "▸ 其他哈希";
            toggle.addEventListener("click", () => {
                const open = detail.style.display !== "none";
                detail.style.display = open ? "none" : "block";
                toggle.textContent = open ? "▸ 其他哈希" : "▾ 其他哈希";
            });
            block.appendChild(toggle);
            block.appendChild(detail);
            box.appendChild(block);
        });
    }

    function refreshMd5Badge() {
        const badge = document.getElementById("badge-md5-info");
        if (md5Items.length === 0) {
            badge.style.display = "none";
            boxMd5.querySelector(".upload-icon").style.display = "";
            boxMd5.querySelector(".upload-text").style.display = "";
            boxMd5.querySelector(".upload-hint").style.display = "";
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = md5Items.length === 1
            ? `已选 1 个文件`
            : `已选 ${md5Items.length} 个文件`;
    }

    inputMd5.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length === 0) return;
        for (const file of files) {
            try {
                const buf = new Uint8Array(await file.arrayBuffer());
                const hashes = await computeMd5Hashes(buf);
                md5Items.push({ file, name: file.name, size: file.size, bytes: buf, hashes });
            } catch (err) { /* 单个失败跳过 */ }
        }
        renderMd5List();
        refreshMd5Badge();
    });

    document.getElementById("btn-md5-copy").addEventListener("click", async () => {
        if (md5Items.length === 0) return;
        const text = md5Items.map((item, i) =>
            `文件名: ${item.name}\n` + Object.entries(item.hashes).map(([k, v]) => `${k}: ${v}`).join("\n")
        ).join("\n\n");
        try {
            await navigator.clipboard.writeText(text);
            alert(`已复制 ${md5Items.length} 个文件的哈希到剪贴板`);
        } catch (e) {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById("txt-md5-hashes"));
            const sel = getSelection();
            sel.removeAllRanges(); sel.addRange(range);
            alert("已选中哈希内容，请按 Ctrl+C 复制");
        }
    });

    document.getElementById("btn-md5-clear").addEventListener("click", () => {
        md5Items = [];
        renderMd5List();
        refreshMd5Badge();
        document.getElementById("txt-md5-modify-result").textContent = "";
        document.getElementById("input-md5-bytes").value = "png-phantom-tank";
        document.getElementById("input-md5-bytes2").value = "1234567890";
        resetMd5Box();
    });

    function resetMd5Box() {
        boxMd5.querySelector(".upload-icon").style.display = "";
        boxMd5.querySelector(".upload-text").style.display = "";
        boxMd5.querySelector(".upload-hint").style.display = "";
    }

    // 批量修改：所有文件末尾追加 [主字节][副字节][随机]（每个文件独立随机）→ 逐个下载
    document.getElementById("btn-md5-modify").addEventListener("click", async () => {
        if (md5Items.length === 0) { alert("请先选择文件"); return; }
        const main = document.getElementById("input-md5-bytes").value;
        const sub = document.getElementById("input-md5-bytes2").value;
        const useRandom = document.getElementById("chk-md5-random").checked;
        if (!main && !sub && !useRandom) { alert("请至少填写一项字节内容或勾选随机"); return; }
        const btn = document.getElementById("btn-md5-modify");
        btn.disabled = true;
        const enc = new TextEncoder();
        let done = 0;
        const results = [];
        for (const item of md5Items) {
            const parts = [item.bytes];
            if (main) parts.push(enc.encode(main));
            if (sub) parts.push(enc.encode(sub));
            if (useRandom) {
                const n = 8 + Math.floor(Math.random() * 17);
                const rnd = new Uint8Array(n);
                crypto.getRandomValues(rnd);
                parts.push(rnd);
            }
            const total = parts.reduce((s, p) => s + p.length, 0);
            const out = new Uint8Array(total);
            let off = 0;
            for (const part of parts) { out.set(part, off); off += part.length; }
            const newMd5 = (await md5Hash(out)).toUpperCase();
            const added = out.length - item.size;
            results.push(`${item.name} → 新 MD5: ${newMd5}（追加 ${added} 字节）`);
            // 逐个触发下载（间隔 200ms 防浏览器拦截）
            setTimeout(() => {
                const blob = new Blob([out], { type: "application/octet-stream" });
                const dot = item.name.lastIndexOf(".");
                const base = dot > 0 ? item.name.slice(0, dot) : item.name;
                const ext = dot > 0 ? item.name.slice(dot) : "";
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${base} - 副本${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, done * 200);
            done++;
        }
        setTimeout(() => {
            document.getElementById("txt-md5-modify-result").textContent =
                `已生成 ${results.length} 个新文件（逐个下载中）｜ ${results[results.length - 1]}`;
            btn.disabled = false;
        }, (done - 1) * 200 + 100);
    });

    
    const modal = document.getElementById("modal-preview");
    const modalImg = document.getElementById("modal-img");
    const modalStage = document.getElementById("modal-stage");
    const zoomLabel = document.getElementById("txt-zoom-level");

    const MIN_SCALE = 1;      // 1 = 适配屏幕的原始大小
    const MAX_SCALE = 8;

    let viewScale = 1;
    let viewX = 0;            // 平移量（px）
    let viewY = 0;
    let baseW = 0;            // 适配后的显示尺寸，用于限制平移范围
    let baseH = 0;

    function applyView() {
        modalImg.style.transform =
            `translate(${viewX}px, ${viewY}px) scale(${viewScale})`;
        zoomLabel.textContent = Math.round(viewScale * 100) + "%";
        modalStage.classList.toggle("grabbing", false);
    }

    // 限制平移范围，避免把图拖出视野
    function clampPan() {
        const rect = modalStage.getBoundingClientRect();
        const scaledW = baseW * viewScale;
        const scaledH = baseH * viewScale;
        // 图比容器小时不允许平移；比容器大时允许移动到边缘
        const maxX = Math.max(0, (scaledW - rect.width) / 2);
        const maxY = Math.max(0, (scaledH - rect.height) / 2);
        viewX = Math.min(maxX, Math.max(-maxX, viewX));
        viewY = Math.min(maxY, Math.max(-maxY, viewY));
    }

    function resetView() {
        viewScale = 1;
        viewX = 0;
        viewY = 0;
        applyView();
    }

    // 以某个锚点（相对容器中心）为基准缩放，保证手指/光标下的位置不跑
    function zoomAt(nextScale, anchorX, anchorY) {
        const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        if (clamped === viewScale) return;
        const ratio = clamped / viewScale;
        viewX = anchorX - (anchorX - viewX) * ratio;
        viewY = anchorY - (anchorY - viewY) * ratio;
        viewScale = clamped;
        clampPan();
        applyView();
    }

    function measureBaseSize() {
        const rect = modalStage.getBoundingClientRect();
        const nw = modalImg.naturalWidth || rect.width;
        const nh = modalImg.naturalHeight || rect.height;
        // modal-content 用 max-width/max-height 适配，这里按同样规则算显示尺寸
        const maxW = rect.width * 0.92;
        const maxH = rect.height;
        const fit = Math.min(maxW / nw, maxH / nh, 1);
        baseW = nw * fit;
        baseH = nh * fit;
    }

    // ===== 多图浏览状态 =====
    let modalList = [];      // [{ url, label }]
    let modalIndex = 0;

    const txtModalCounter = document.getElementById("txt-modal-counter");

    function updateModalNav() {
        const total = modalList.length;
        const multi = total > 1;
        txtModalCounter.hidden = !multi;
        if (multi) {
            txtModalCounter.textContent = `${modalIndex + 1} / ${total}`;
        }
    }

    function loadModalImage(url) {
        resetView();
        modalImg.src = url;

        const onReady = () => {
            measureBaseSize();
            resetView();
            modalImg.removeEventListener("load", onReady);
        };

        if (modalImg.complete && modalImg.naturalWidth > 0) {
            measureBaseSize();
            resetView();
        } else {
            modalImg.addEventListener("load", onReady);
        }
    }

    /**
     * 打开大图查看器。
     * @param {string|Array} source 单个 URL，或 [{ url, label }] 列表
     * @param {number} startIndex 起始索引（列表模式）
     */
    function showModal(source, startIndex = 0) {
        if (!source) return;

        if (Array.isArray(source)) {
            modalList = source.filter(it => it && it.url);
            if (modalList.length === 0) return;
            modalIndex = Math.min(Math.max(0, startIndex), modalList.length - 1);
        } else {
            modalList = [{ url: source, label: "" }];
            modalIndex = 0;
        }

        modal.classList.add("open");
        updateModalNav();
        loadModalImage(modalList[modalIndex].url);
    }

    function showModalAt(index) {
        if (modalList.length === 0) return;
        const total = modalList.length;
        modalIndex = ((index % total) + total) % total;   // 循环
        updateModalNav();
        loadModalImage(modalList[modalIndex].url);
    }

    function showNextImage() { showModalAt(modalIndex + 1); }
    function showPrevImage() { showModalAt(modalIndex - 1); }


    function closeModal() {
        modal.classList.remove("open");
        modalImg.removeAttribute("src");
        modalList = [];
        modalIndex = 0;
        updateModalNav();
    }

    // --- 工具栏 ---
    document.getElementById("btn-zoom-in").addEventListener("click", () => zoomAt(viewScale * 1.25, 0, 0));
    document.getElementById("btn-zoom-out").addEventListener("click", () => zoomAt(viewScale / 1.25, 0, 0));
    document.getElementById("btn-zoom-reset").addEventListener("click", resetView);
    document.getElementById("btn-modal-close").addEventListener("click", closeModal);

    // 点击遮罩空白处关闭。
    // 注意：拖动时我们会 setPointerCapture，松开后 click 的 target 会变成舞台，
    // 所以必须用"位移量 + 按下位置"来区分点击与拖动，避免拖完自动退出。
    const CLICK_MOVE_TOLERANCE = 6;   // 位移小于该值才算点击（px）
    let gesture = null;               // { x, y, moved, onBlank }

    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    // --- 滚轮缩放（桌面） ---
    modalStage.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = modalStage.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomAt(viewScale * factor, cx, cy);
    }, { passive: false });

    // --- 拖拽 / 双指平移与缩放（鼠标 + 触屏统一用 Pointer 事件） ---
    const pointers = new Map();
    let lastDist = 0;
    let swipe = null;          // 单指滑动切图手势 { id, x, y, time }

    modalStage.addEventListener("pointerdown", (e) => {
        // 统一捕获指针，确保后续 pointerup 一定落在本元素上
        try { modalStage.setPointerCapture(e.pointerId); } catch (err) {}

        const onImg = (e.target === modalImg || modalImg.contains(e.target));
        if (onImg) {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            modalStage.classList.add("grabbing");
        }

        // 触摸左右滑动切图：未放大时在舞台任意位置起手都生效（含图片与空白），
        // 放大后交给拖动平移处理，避免冲突。
        if (viewScale <= 1 && modalList.length > 1) {
            swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now(), active: false };
        }

        // 记录本次手势起点，用于结束后判断是"点击空白"还是"拖动"
        if (!gesture) {
            gesture = {
                x: e.clientX,
                y: e.clientY,
                moved: false,
                // 只有按在舞台任意位置（图片或空白）才算数，工具栏在舞台外不受影响
                onBlank: !onImg
            };
        }
    });

    modalStage.addEventListener("pointermove", (e) => {
        // 超过容差即视为拖动，不再算作点击
        if (gesture && !gesture.moved) {
            if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > CLICK_MOVE_TOLERANCE) {
                gesture.moved = true;
            }
        }

        if (!pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 1) {
            // 单指/鼠标拖动平移
            if (viewScale > 1) {
                viewX += dx;
                viewY += dy;
                clampPan();
                applyView();
            }
        } else if (pointers.size === 2) {
            // 双指捏合缩放
            const pts = Array.from(pointers.values());
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const rect = modalStage.getBoundingClientRect();
            const cx = (pts[0].x + pts[1].x) / 2 - rect.left - rect.width / 2;
            const cy = (pts[0].y + pts[1].y) / 2 - rect.top - rect.height / 2;

            if (lastDist > 0) {
                zoomAt(viewScale * (dist / lastDist), cx, cy);
            }
            lastDist = dist;
        }
    });

    function endPointer(e) {
        // 单指横向快速滑动 -> 上一张 / 下一张（未放大时）
        if (swipe && swipe.id === e.pointerId) {
            const s = swipe;
            swipe = null;
            const dx = e.clientX - s.x;
            const dy = e.clientY - s.y;
            const dt = Date.now() - s.time;
            const fast = Math.abs(dx) > 55 && dt < 700;                 // 快速划动
            const long = Math.abs(dx) > 110 && Math.abs(dy) < 80;       // 长距离拖拽
            if ((fast || long) && Math.abs(dx) > Math.abs(dy) * 1.2) {
                if (dx < 0) showNextImage();
                else showPrevImage();
                // 已判定为滑动切图，阻止后续被当作“点击空白”而关闭
                if (gesture) gesture.moved = true;
            }
        }

        if (pointers.has(e.pointerId)) {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) lastDist = 0;
            if (pointers.size === 0) modalStage.classList.remove("grabbing");
        }

        try { modalStage.releasePointerCapture(e.pointerId); } catch (err) {}

        // 指针全部离开后结算：只有"在空白处按下且几乎没移动"才算点击关闭
        if (pointers.size === 0) {
            const g = gesture;
            gesture = null;
            if (g && g.onBlank && !g.moved) {
                closeModal();
            }
        }
    }

    modalStage.addEventListener("pointerup", endPointer);
    modalStage.addEventListener("pointercancel", endPointer);
    // 注：不监听 pointerleave，否则拖动时鼠标滑出边缘会误判为点击而关闭

    // 双击复位 / 放大
    modalStage.addEventListener("dblclick", (e) => {
        if (e.target !== modalImg) return;
        if (viewScale > 1) resetView();
        else zoomAt(2.5, 0, 0);
    });

    // 键盘：Esc 关闭，+/- 缩放
    document.addEventListener("keydown", (e) => {
        if (!modal.classList.contains("open")) return;
        if (e.key === "Escape") closeModal();
        else if (e.key === "+" || e.key === "=") zoomAt(viewScale * 1.25, 0, 0);
        else if (e.key === "-") zoomAt(viewScale / 1.25, 0, 0);
        else if (e.key === "0") resetView();
        else if (e.key === "ArrowLeft") showPrevImage();
        else if (e.key === "ArrowRight") showNextImage();
    });

    // 窗口尺寸变化时重新计算基准尺寸
    window.addEventListener("resize", () => {
        if (!modal.classList.contains("open")) return;
        measureBaseSize();
        if (viewScale <= 1) resetView();
        else { clampPan(); applyView(); }
    });

    // 还原结果：点击真图 / 封面缩略图查看大图
    const imgRestoredPreview = document.getElementById("img-restored-preview");
    const imgRestoreCover = document.getElementById("img-restore-cover");

    if (imgRestoredPreview) {
        imgRestoredPreview.addEventListener("click", () => {
            if (!imgRestoredPreview.getAttribute("src")) return;
            // 批量还原后支持在大图里左右切换查看全部结果
            const list = (lastRestoredResults || [])
                .filter(r => r && r.url)
                .map(r => ({ url: r.url, label: r.filename || "" }));
            const idx = list.findIndex(it => it.url === imgRestoredPreview.src);
            showModal(list.length ? list : imgRestoredPreview.src, idx >= 0 ? idx : 0);
        });
    }

    if (imgRestoreCover) {
        imgRestoreCover.addEventListener("click", () => {
            if (imgRestoreCover.getAttribute("src")) {
                showModal(imgRestoreCover.src);
            }
        });
    }

    // ===== 拖拽上传支持 =====
    // 说明：dropBoxes 与全局拦截已提前到回调顶部声明，
    // 避免在 enableDropUpload 首次调用时命中 TDZ 报错。
    function enableDropUpload(box, input) {
        let depth = 0;

        const setActive = (on) => box.classList.toggle("dragover", on);

        box.addEventListener("dragenter", e => {
            e.preventDefault();
            e.stopPropagation();
            depth++;
            setActive(true);
        });

        box.addEventListener("dragover", e => {
            e.preventDefault();
            e.stopPropagation();
            // 明确声明为"复制"，部分浏览器据此决定是否允许 drop
            try { e.dataTransfer.dropEffect = "copy"; } catch (err) {}
        });

        box.addEventListener("dragleave", e => {
            e.preventDefault();
            e.stopPropagation();
            depth = Math.max(0, depth - 1);
            if (depth === 0) setActive(false);
        });

        box.addEventListener("drop", e => {
            e.preventDefault();
            e.stopPropagation();
            depth = 0;
            setActive(false);

            const dt = e.dataTransfer;
            if (!dt || !dt.files || dt.files.length === 0) {
                alert("没有检测到文件，请把本地图片文件拖拽到这里");
                return;
            }

            // 把拖入的文件写回 input，并派发 change，
            // 这样各处既有的选择逻辑可以完全复用
            try {
                input.files = dt.files;
            } catch (err) {
                // 部分浏览器不允许直接赋值 files，退化为 DataTransfer 方式
                const transfer = new DataTransfer();
                for (let i = 0; i < dt.files.length; i++) {
                    transfer.items.add(dt.files[i]);
                }
                input.files = transfer.files;
            }
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    // 辅助加载
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // blob:/data: 等本地对象 URL 不应设置 crossOrigin，否则在 file:// 页面会
            // 被判为跨域而污染 canvas，导致 getImageData 抛错（伪装生成失败: undefined）。
            if (/^https?:\/\//i.test(url)) img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    function elementToPngBlob(drawable) {
        if (drawable instanceof HTMLCanvasElement) {
            return new Promise(resolve => drawable.toBlob(resolve, "image/png"));
        }
        // If it is an HTMLImageElement or similar
        const canvas = document.createElement("canvas");
        canvas.width = drawable.naturalWidth || drawable.width;
        canvas.height = drawable.naturalHeight || drawable.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(drawable, 0, 0);
        return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    }
});
