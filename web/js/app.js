    // ===== 公共：文件列表渲染组件 =====
    // 供 MD5 工具 / 格式转换 / 图片压缩等批量功能复用。
    // items: [{ name, size }]；onRemove(i) 为点击 ✕ 的回调；opts.containerId 列表容器、
    // opts.actionsId "全部移除"按钮所在行（可空）、opts.onClearAll 全清回调（可空）。
    // 样式使用 merge-file-item 行（序号/文件名/大小/✕），空列表时隐藏容器与操作行。
    function renderFileList(items, onRemove, opts) {
        const listEl = document.getElementById(opts.containerId);
        const actionsEl = opts.actionsId ? document.getElementById(opts.actionsId) : null;
        listEl.innerHTML = "";
        if (actionsEl) actionsEl.style.display = items.length ? "flex" : "none";
        items.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = "merge-file-item";
            const order = document.createElement("span");
            order.className = "merge-file-order";
            order.textContent = String(i + 1);
            const name = document.createElement("span");
            name.className = "merge-file-name";
            name.textContent = `${item.name} (${(item.size / 1024).toFixed(0)} KB)`;
            const del = document.createElement("button");
            del.className = "merge-file-del";
            del.textContent = "✕";
            del.title = "移除";
            del.addEventListener("click", () => onRemove(i));
            row.appendChild(order);
            row.appendChild(name);
            row.appendChild(del);
            listEl.appendChild(row);
        });
    }
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
        "page-md5":       { emoji: "🧰", name: "图片工具", path: "/md5" },
        "page-classic":   { emoji: "🌗", name: "经典幻影", path: "/classic" }
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
        // 图片处理 / 图片工具 两页的功能名换成子功能切换；其他功能页显示功能名
        const hasSubTabs = targetId === "page-merge" || targetId === "page-md5" || targetId === "page-classic";
        document.getElementById("merge-sub-tabs").hidden = !hasSubTabs;
        document.getElementById("txt-feature-name").hidden = hasSubTabs;
        if (hasSubTabs) {
            applySubTabsForPage(targetId);   // 按页过滤子标签并回到第一项
        } else if (isFeature) {
            // 注意：回主页时 targetId 不在 FEATURE_PAGES 里，必须守卫，否则这里抛错
            // 会中断 switchPage，房子图标的 hidden 之后的逻辑全不执行（回归 bug）
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
    let cleanSources = [];      // [{ canvas, filename, bytes(原文件字节，供 EXIF 写入) }]
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
                    list.push({ canvas, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
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
            if (type === 7 || type === 1) {   // UNDEFINED/BYTE：显示十六进制（版本号等）
                const hex2 = [];
                for (let i = 0; i < num && off + i < v.length; i++) hex2.push(v[off + i].toString(16).padStart(2, "0"));
                return hex2.join(" ");
            }
            if (type === 10 && num >= 1 && num <= 4) {  // SRATIONAL（快门/光圈 APEX、曝光补偿等）
                const vals = [];
                for (let i = 0; i < num; i++) {
                    const n = metaReadU32(v, off + i * 8, le);
                    const d = metaReadU32(v, off + i * 8 + 4, le);
                    vals.push(d === 0 ? 0 : n / d);
                }
                return num === 1 ? vals[0] : vals.join(", ");
            }
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
            if (exifChunk) {
                tiff = exifChunk.payload;
            } else {
                // 兼容 ImageMagick 传统写法：tEXt "Raw profile type exif"（hex 文本）
                const rawProfile = chunks.find(c => c.type === "tEXt" &&
                    c.payload.length > 22 && new TextDecoder().decode(c.payload.slice(0, 22)) === "Raw profile type exif\0");
                if (rawProfile) {
                    try {
                        const txt = new TextDecoder("latin1").decode(rawProfile.payload.slice(21));
                        const lines = txt.split("\n").map(l => l.trim()).filter(Boolean);
                        // 格式：exif / 长度 / hex行...
                        if (lines[0] === "exif" && lines.length >= 3) {
                            const hexStr = lines.slice(2).join("");
                            const bytes = new Uint8Array(hexStr.length / 2);
                            for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hexStr.substr(i * 2, 2), 16);
                            tiff = bytes;
                        }
                    } catch (e) { /* 还原失败按无处理 */ }
                }
            }
        }
        if (!tiff || tiff.length < 8) return { exif: [], gps: [], gpsCoord: null, textChunks: extractMetaChunks(raw) };

        const isLE = tiff[0] === 0x49 && tiff[1] === 0x49;
        isBE = tiff[0] === 0x4D && tiff[1] === 0x4D;
        if (!isLE && !isBE) return { exif: [], gps: [], gpsCoord: null, textChunks: extractMetaChunks(raw) };

        const parsed = parseTiffExif(tiff, isBE);
        parsed.textChunks = extractMetaChunks(raw).filter(c => c.type !== "eXIf");
        return parsed;
    }

    // 解析 PNG 文本块为可读文本（异步：压缩块需 zlib 解压）：
    // tEXt: keyword\0text（Latin-1）
    // iTXt: keyword\0 compressionFlag(1) compressionMethod(1) languageTag\0 translatedKeyword\0 text(UTF-8, 可 zlib 压缩)
    // zTXt: keyword\0 compressionMethod(1) text(zlib 压缩, Latin-1)
    // 返回 { keyword, value, isImportant }；isImportant 标记 AI 生成参数（提示词/Steps/Sampler 等）
    async function parseTextChunk(c) {
        try {
            const p = c.payload;
            const z = p.indexOf(0);
            if (z < 0) return null;
            const keyword = new TextDecoder("latin1").decode(p.slice(0, z));
            let value = "";
            if (c.type === "tEXt") {
                value = new TextDecoder("latin1").decode(p.slice(z + 1));
            } else if (c.type === "iTXt") {
                const flag = p[z + 1], method = p[z + 2];
                // languageTag\0 translatedKeyword\0 之后是正文
                let q = z + 3;
                const q1 = p.indexOf(0, q); if (q1 < 0) return null;
                q = p.indexOf(0, q1 + 1); if (q < 0) return null;
                let body = p.slice(q + 1);
                if (flag === 1 && method === 0) {
                    body = await inflateZlib(body);   // zlib（RFC1950）解压
                }
                value = new TextDecoder("utf-8").decode(body);
            } else if (c.type === "zTXt") {
                const method = p[z + 1];
                if (method !== 0) return null;
                value = new TextDecoder("latin1").decode(await inflateZlib(p.slice(z + 2)));
            } else {
                return null;
            }
            // 重要内容识别：AI 生成参数特征（提示词 / 采样参数 / NovelAI / StableDiffusion 等）
            const importantHints = ["parameters", "prompt", "negative", "steps", "sampler", "seed", "novelai", "stable diffusion", "checkpoint", "lora", "cfg", "denois", "comment"];
            const low = (keyword + "\n" + value.slice(0, 400)).toLowerCase();
            const isImportant = importantHints.some(h => low.includes(h)) || value.length > 300;
            return { keyword, value, isImportant };
        } catch (e) {
            return null;
        }
    }

    // zlib 解压（浏览器原生 DecompressionStream("deflate") = RFC1950 zlib 格式）
    // 返回 Promise<Uint8Array>；不支持的浏览器抛错由 parseTextChunk 捕获降级
    async function inflateZlib(bytes) {
        if (typeof DecompressionStream === "undefined") throw new Error("no DecompressionStream");
        const ds = new DecompressionStream("deflate");
        const stream = new Blob([bytes]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }

    // 渲染单张图片的解析结果（异步：文本块可能需 zlib 解压）
    async function renderMetaView(file, meta) {
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

        // 文本块（tEXt/iTXt/zTXt）完整解析：AI 绘图的提示词与生成参数都在这里
        for (const c of meta.textChunks) {
            // "Raw profile type exif" 是 EXIF 的 tEXt 载体（已在上方解析为拍摄参数表），跳过
            if (c.type === "tEXt" && c.payload.length > 21 &&
                new TextDecoder("latin1").decode(c.payload.slice(0, 22)) === "Raw profile type exif\0") continue;
            const parsed = await parseTextChunk(c);
            if (!parsed) continue;
            // 关键内容（提示词/生成参数）用大卡片展示：可展开收起，超长提供 txt 下载
            const important = parsed.isImportant;
            const shortText = parsed.value.length <= 200;
            const holder = document.createElement("div");
            holder.className = "meta-table-wrap";
            let html = `<table class="meta-table"><tr><th style="width:96px;">${c.type}${parsed.keyword ? " · " + escapeHtml(parsed.keyword) : ""}</th>` +
                `<th>${important ? "🎨 " : ""}内容（${parsed.value.length} 字符）</th></tr>` +
                `<tr><td class="meta-k"></td><td class="meta-v"><div class="meta-text${important ? " meta-text-long" : ""}" ${shortText ? "" : 'data-clamped="1"'}>${escapeHtml(parsed.value)}</div>`;
            if (!shortText) {
                html += `<div class="meta-text-actions">` +
                    `<button class="gm-reset-btn meta-text-toggle" type="button">展开全部</button>` +
                    `<button class="gm-reset-btn meta-text-dl" type="button">⬇ 下载 txt</button></div>`;
            }
            html += `</td></tr></table>`;
            holder.innerHTML = html;
            // 展开/收起
            const toggle = holder.querySelector(".meta-text-toggle");
            if (toggle) {
                toggle.addEventListener("click", () => {
                    const div = holder.querySelector(".meta-text");
                    const open = div.dataset.clamped === "1";
                    div.dataset.clamped = open ? "0" : "1";
                    toggle.textContent = open ? "收起" : "展开全部";
                });
            }
            // 下载 txt
            const dl = holder.querySelector(".meta-text-dl");
            if (dl) {
                dl.addEventListener("click", () => {
                    const blob = new Blob([parsed.value], { type: "text/plain;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${file.name.replace(/\.[^.]+$/, "")}_${c.type}${parsed.keyword ? "_" + parsed.keyword.replace(/[^\w.-]/g, "") : ""}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                });
            }
            out.push(holder);
        }

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
                const els = await renderMetaView(f, meta);
                els.forEach(el => box.appendChild(el));
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

    // 8.1.2 EXIF 写入（隐私反向运用）：把自定义的相机型号 / 拍摄时间 / GPS 写进图片元数据。
    // 原理：PNG 在 IEND 前插入 eXIf 块；JPEG 在 SOI 后插入 APP1("Exif\0\0"+TIFF)。
    // 必须直接操作原始文件字节——canvas 重编码会丢掉一切元数据。

    // ---- TIFF/EXIF 序列化工具 ----
    // 类型码：1=BYTE 2=ASCII 3=SHORT 4=LONG 5=RATIONAL 7=UNDEFINED 9=SLONG 10=SRATIONAL
    function exifTypeSize(t) { return [0, 1, 1, 2, 4, 8, 1, 0, 0, 4, 8][t] || 1; }

    function exifEntry(tag, type, values) {
        // 返回 {tag, type, count, dataBytes(Uint8Array，小端), valueOffsetPlaceholder}
        const size = exifTypeSize(type) * values.length;
        let data;
        if (type === 2) {           // ASCII
            data = new TextEncoder().encode(values.join("") + "\0");
        } else if (type === 3) {    // SHORT
            data = new Uint8Array(values.length * 2);
            const dv = new DataView(data.buffer);
            values.forEach((v, i) => dv.setUint16(i * 2, v, true));
        } else if (type === 4 || type === 9) { // LONG/SLONG
            data = new Uint8Array(values.length * 4);
            const dv = new DataView(data.buffer);
            values.forEach((v, i) => dv.setUint32(i * 2 * 2, v, true));
        } else if (type === 5 || type === 10) { // RATIONAL（值为 [num,den] 对数组）
            data = new Uint8Array(values.flat().length * 4);
            const dv = new DataView(data.buffer);
            values.flat().forEach((v, i) => dv.setUint32(i * 4, v, true));
        } else {                    // UNDEFINED 等按字节
            data = new Uint8Array(values);
        }
        const count = (type === 2) ? data.length : (type === 5 || type === 10 ? values.length : values.length);
        return { tag, type, count, data, inline: data.length <= 4 };
    }

    // 构建一个 IFD：entries 数组 → { ifdBytes, externalData(Uint8Array 数组拼接) }
    function buildIfd(entries, nextIfdOffset) {
        // 布局：count(2) + entries(12*n) + nextIFD(4) + 外部数据区
        // EXIF 规范要求条目按 tag 升序存储——排序后显示顺序也与真实相机一致
        entries = entries.slice().sort((a, b) => a.tag - b.tag);
        const n = entries.length;
        const ifdSize = 2 + n * 12 + 4;
        const external = [];
        let extOffset = ifdSize;
        const header = new Uint8Array(ifdSize);
        const dv = new DataView(header.buffer);
        dv.setUint16(0, n, true);
        entries.forEach((e, i) => {
            const off = 2 + i * 12;
            dv.setUint16(off, e.tag, true);
            dv.setUint16(off + 2, e.type, true);
            dv.setUint32(off + 4, e.count, true);
            if (e.inline) {
                header.set(e.data, off + 8);   // ≤4 字节内联
                // 右侧补 0
                for (let k = e.data.length; k < 4; k++) dv.setUint8(off + 8 + k, 0);
            } else {
                dv.setUint32(off + 8, extOffset, true);
                external.push(e.data);
                extOffset += e.data.length;
            }
        });
        dv.setUint32(2 + n * 12, nextIfdOffset || 0, true);
        return { header, external };
    }

    // 构造完整 TIFF EXIF 载荷（小端 "II"）：IFD0(相机+软件+DateTime+ExifIFD指针+GPS指针) + ExifIFD + GPS IFD
    // fields: { make, model, software, datetime, lat, lon, latRef, lonRef }
    function buildExifTiff(fields) {
        // 完整字段：品牌/型号/镜头/软件/拍摄/修改时间/曝光(F,ISO,焦距)/GPS/像素尺寸
        // 专业参数（APEX 等）由换算自动生成，不暴露给用户
        const hasExif = !!(fields.datetime || fields.exposureSec !== undefined || fields.fnumber !== undefined || fields.iso !== undefined || fields.focal !== undefined);
        const hasGps = fields.lat !== undefined && fields.lon !== undefined;
        const latRef = fields.latRef || (fields.lat < 0 ? 'S' : 'N');
        const lonRef = fields.lonRef || (fields.lon < 0 ? 'W' : 'E');

        // ---- IFD0 ----
        const ifd0 = [];
        if (fields.make) ifd0.push(exifEntry(0x010F, 2, [fields.make]));
        if (fields.model) ifd0.push(exifEntry(0x0110, 2, [fields.model]));
        if (fields.software) ifd0.push(exifEntry(0x0131, 2, [fields.software]));
        if (fields.modify) ifd0.push(exifEntry(0x0132, 2, [fields.modify]));
        ifd0.push(exifEntry(0x0100, 4, [fields.pixelW || 0]));   // 图像宽度
        ifd0.push(exifEntry(0x0101, 4, [fields.pixelH || 0]));   // 图像高度
        ifd0.push(exifEntry(0x0112, 3, [1]));                    // 拍摄方向 = 1（已转正）
        ifd0.push(exifEntry(0x0128, 3, [2]));                    // 分辨率单位 = 英寸（模板有）
        ifd0.push(exifEntry(0x0213, 3, [1]));                    // YCbCr 定位 = 居中
        // 子 IFD 指针在中段统一加入（收集完 Exif/GPS 条目后）

        // ---- Exif 子 IFD 条目 ----
        const exifEntries = [];
        if (hasExif && fields.datetime) {
            exifEntries.push(exifEntry(0x9003, 2, [fields.datetime]));      // DateTimeOriginal
            exifEntries.push(exifEntry(0x9004, 2, [fields.datetime]));      // DateTimeDigitized
            exifEntries.push(exifEntry(0x9011, 2, ["+08:00"]));             // OffsetTimeOriginal
        }
        if (fields.exposureSec !== undefined) {
            const apexShutter = Math.round(-Math.log2(fields.exposureSec) * 1000);
            exifEntries.push(exifEntry(0x9201, 10, [[apexShutter, 1000]]));
            const den = Math.max(1, Math.round(1 / fields.exposureSec));
            if (fields.exposureSec < 1) exifEntries.push(exifEntry(0x829A, 5, [[1, den]]));
            else exifEntries.push(exifEntry(0x829A, 5, [[Math.round(fields.exposureSec * 1000), 1000]]));
        }
        if (fields.fnumber !== undefined) {
            const apexAperture = Math.round(2 * Math.log2(fields.fnumber) * 100);
            exifEntries.push(exifEntry(0x9202, 10, [[apexAperture, 100]]));
            exifEntries.push(exifEntry(0x829D, 5, [[Math.round(fields.fnumber * 10), 10]]));
        }
        if (fields.iso !== undefined) exifEntries.push(exifEntry(0x8827, 3, [fields.iso]));
        if (fields.focal !== undefined) exifEntries.push(exifEntry(0x920A, 5, [[Math.round(fields.focal * 1000), 1000]]));
        if (fields.lens) exifEntries.push(exifEntry(0xA434, 2, [fields.lens]));
        exifEntries.push(exifEntry(0x9204, 10, [[0, 6]]));    // 曝光补偿 0
        exifEntries.push(exifEntry(0x9207, 3, [2]));          // 测光 = 中心加权
        exifEntries.push(exifEntry(0x9209, 3, [16]));         // 闪光灯 = 未闪/强制
        exifEntries.push(exifEntry(0x9208, 3, [0]));          // 白平衡 = 自动

        exifEntries.push(exifEntry(0xA001, 3, [1]));          // 色彩空间 sRGB
        exifEntries.push(exifEntry(0xA002, 4, [fields.pixelW || 0]));
        exifEntries.push(exifEntry(0xA003, 4, [fields.pixelH || 0]));
        exifEntries.push(exifEntry(0x8822, 3, [0]));          // 曝光模式 = 自动曝光
        exifEntries.push(exifEntry(0x9203, 10, [[499, 100]])); // 亮度（APEX，合理默认 4.99）
        exifEntries.push(exifEntry(0x9205, 10, [[Math.round(2 * Math.log2(fields.fnumber || 2) * 100), 100]])); // 最大光圈 = 光圈
        if (hasExif) {
            // 子秒（毫秒占位 000，模板里有 618——沿用 000 占位）
            exifEntries.push(exifEntry(0x9290, 2, [ "000"]));      // SubSecTime
            exifEntries.push(exifEntry(0x9291, 2, [ "000"]));      // SubSecTimeOriginal
            exifEntries.push(exifEntry(0x9292, 2, [ "000"]));      // SubSecTimeDigitized
        }
        exifEntries.push(exifEntry(0xA217, 3, [0]));          // 感光方式 = 未定义
        exifEntries.push(exifEntry(0xA402, 3, [0]));          // 曝光模式 = 自动
        exifEntries.push(exifEntry(0xA403, 3, [0]));          // 白平衡 = 自动
        exifEntries.push(exifEntry(0xA404, 10, [[0, 1]]));    // 数字变焦 = 无（0）
        if (fields.focal !== undefined) {
            // 35mm 等效焦距：OnePlus 主摄 6.06mm ≈ 23mm 等效；超广角 2.3mm ≈ 15mm
            const eq35 = Math.abs(fields.focal - 6.06) < 0.1 ? 23 : (Math.abs(fields.focal - 2.3) < 0.1 ? 15 : Math.round(fields.focal * 3.8));
            exifEntries.push(exifEntry(0xA405, 3, [eq35]));
        }
        exifEntries.push(exifEntry(0xA406, 3, [0]));          // 场景捕捉类型 = 标准

        // ---- GPS 子 IFD 条目 ----
        const toDms = (dec) => {
            const abs = Math.abs(dec);
            const d = Math.floor(abs);
            const mFloat = (abs - d) * 60;
            const m = Math.floor(mFloat);
            const s = Math.round((mFloat - m) * 60 * 100);
            return [[d, 1], [m, 1], [s, 100]];
        };
        const gpsEntries = [];
        if (hasGps) {
            gpsEntries.push(exifEntry(0x0000, 7, [0x02, 0x03, 0x00, 0x00]));  // GPSVersion 2.3
            gpsEntries.push(exifEntry(0x0001, 2, [latRef]));
            gpsEntries.push(exifEntry(0x0002, 5, toDms(fields.lat)));
            gpsEntries.push(exifEntry(0x0003, 2, [lonRef]));
            gpsEntries.push(exifEntry(0x0004, 5, toDms(fields.lon)));
        }

        // ---- IFD0 加入子 IFD 指针（必须在计算 IFD0 头大小之前）----
        if (exifEntries.length) ifd0.push(exifEntry(0x8769, 4, [0]));
        if (gpsEntries.length) ifd0.push(exifEntry(0x8825, 4, [0]));
        // ---- 偏移计算与拼接 ----
        const ifd0Obj = buildIfd(ifd0, 0);
        const ifd0HeaderLen = ifd0Obj.header.length;
        const exifPtr = 8 + ifd0HeaderLen;
        const exifObj = buildIfd(exifEntries, 0);
        const exifHeaderLen = exifObj.header.length;
        const gpsPtr = exifPtr + exifHeaderLen;
        const gpsObj = buildIfd(gpsEntries, 0);
        const baseIfd0Ext = 8 + ifd0HeaderLen + exifHeaderLen + gpsObj.header.length;

        const fixed0 = new Uint8Array(ifd0Obj.header);
        const dv0 = new DataView(fixed0.buffer);
        let extAcc = 0;
        for (let i = 0; i < dv0.getUint16(0, true); i++) {
            const off = 2 + i * 12;
            const tag = dv0.getUint16(off, true);
            const total = exifTypeSize(dv0.getUint16(off + 2, true)) * dv0.getUint32(off + 4, true);
            if (tag === 0x8769) dv0.setUint32(off + 8, exifPtr, true);
            else if (tag === 0x8825) dv0.setUint32(off + 8, gpsPtr, true);
            else if (total > 4) { dv0.setUint32(off + 8, baseIfd0Ext + extAcc, true); extAcc += total; }
        }

        const alignEven = (n) => n + (n % 2);
        const extIfd0Len = alignEven(ifd0Obj.external.reduce((s, d) => s + d.length, 0));
        const fixSub = (obj, base) => {
            const fixed = new Uint8Array(obj.header);
            const dv = new DataView(fixed.buffer);
            const n = dv.getUint16(0, true);
            let acc = 0;
            for (let i = 0; i < n; i++) {
                const off = 2 + i * 12;
                const total = exifTypeSize(dv.getUint16(off + 2, true)) * dv.getUint32(off + 4, true);
                if (total > 4) { dv.setUint32(off + 8, base + acc, true); acc += total; }
            }
            return fixed;
        };
        const baseExifExt = baseIfd0Ext + extIfd0Len;
        const exifH = fixSub(exifObj, baseExifExt);
        const baseGpsExt = baseExifExt + alignEven(exifObj.external.reduce((s, d) => s + d.length, 0));
        const gpsH = fixSub(gpsObj, baseGpsExt);

        const pad = (n) => { const p = []; while (n % 2) { p.push(new Uint8Array(1)); n++; } return p; };
        const parts = [
            new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0]),
            fixed0, exifH, gpsH,
            ...ifd0Obj.external, ...pad(extIfd0Len - ifd0Obj.external.reduce((s, d) => s + d.length, 0)),
            ...exifObj.external, ...pad(baseGpsExt - baseExifExt - exifObj.external.reduce((s, d) => s + d.length, 0)),
            ...gpsObj.external
        ];
        const total = parts.reduce((s, p) => s + p.length, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out;
    }

    // PNG：在 IEND 前插入 EXIF。双写两份（工具兼容性最大化）：
    //   1. eXIf 块 —— PNG 1.2 扩展标准写法（新工具支持）
    //   2. tEXt "Raw profile type exif" —— ImageMagick 传统写法（PIL / exiftool / 老工具支持）
    async function injectExifPng(fileBytes, tiff) {
        const chunks = ApngCodec.parseChunks(fileBytes);
        const exifChunk = ApngCodec.chunkBytes("eXIf", tiff);
        // tEXt payload: keyword\0 + "exif\n" + hex长度 + "\n" + hex数据(72字符/行) + "\n"
        const hexLines = [];
        const hex = Array.from(tiff).map(b => b.toString(16).padStart(2, "0")).join("");
        for (let i = 0; i < hex.length; i += 72) hexLines.push(hex.slice(i, i + 72));
        const textPayload = new Uint8Array([
            ...new TextEncoder().encode("Raw profile type exif\0"),
            ...new TextEncoder().encode(`exif\n${tiff.length}\n${hexLines.join("\n")}\n`)
        ]);
        const textChunk = ApngCodec.chunkBytes("tEXt", textPayload);
        const parts = [fileBytes.slice(0, 8)];   // PNG 签名
        let injected = false;
        for (const c of chunks) {
            if (c.type === "IEND") { parts.push(exifChunk); parts.push(textChunk); injected = true; }
            parts.push(ApngCodec.chunkBytes(c.type, c.payload));
        }
        if (!injected) throw new Error("PNG 结构异常");
        return new Blob(parts, { type: "image/png" });
    }

    // JPEG：SOI 后插入 APP1("Exif\0\0" + TIFF)
    async function injectExifJpeg(fileBytes, tiff) {
        if (fileBytes[0] !== 0xFF || fileBytes[1] !== 0xD8) throw new Error("JPEG 结构异常");
        // APP1 段：FF E1 + 段长(2B, 含长度字段自身) + "Exif\0\0"(6B) + TIFF
        const segLen = 2 + 6 + tiff.length;   // 长度字段本身 + "Exif\0\0" + TIFF
        const app1 = new Uint8Array(4 + tiff.length + 6);
        app1[0] = 0xFF; app1[1] = 0xE1;
        app1[2] = (segLen >> 8) & 0xFF; app1[3] = segLen & 0xFF;
        app1.set(new TextEncoder().encode("Exif\0\0"), 4);
        app1.set(tiff, 10);
        const parts = [fileBytes.slice(0, 2), app1, fileBytes.slice(2)];
        return new Blob(parts, { type: "image/jpeg" });
    }

    // EXIF 写入主入口：接收 cleanSources 里的原始文件字节
    async function injectExifToFile(fileOrBytes, fields) {
        const raw = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(await fileOrBytes.arrayBuffer());
        const tiff = buildExifTiff(fields);
        if (raw[0] === 0x89 && raw[1] === 0x50) return await injectExifPng(raw, tiff);
        if (raw[0] === 0xFF && raw[1] === 0xD8) return await injectExifJpeg(raw, tiff);
        throw new Error("仅支持 PNG / JPG（WEBP 请先在「格式转换」里转）");
    }

    // EXIF 写入模板（取自真实 OnePlus 13 样张：竖拍=主摄，横拍=超广角）
    const EXIF_TEMPLATES = {
        portrait: {
            make: "OnePlus", model: "OnePlus 13",
            lens: "OnePlus 13 back camera 6.06mm f/1.6",
            exposure: "1/100", fnumber: "1.6", iso: "196", focal: "6.06"
        },
        landscape: {
            make: "OnePlus", model: "OnePlus 13",
            lens: "OnePlus 13 back camera 2.30mm f/2.0",
            exposure: "1/777", fnumber: "2.0", iso: "160", focal: "2.3"
        }
    };
    document.querySelectorAll("#exif-template-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#exif-template-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const tpl = EXIF_TEMPLATES[btn.getAttribute("data-tpl")];
            document.getElementById("exif-make").value = tpl.make;
            document.getElementById("exif-model").value = tpl.model;
            document.getElementById("exif-lens").value = tpl.lens;
            document.getElementById("exif-exposure").value = tpl.exposure;
            document.getElementById("exif-fnumber").value = tpl.fnumber;
            document.getElementById("exif-iso").value = tpl.iso;
            document.getElementById("exif-focal").value = tpl.focal;
            // 时间/GPS 不动（用户自己填，模板不含位置隐私）
        });
    });
    // 默认填充竖拍模板（页面加载即预填，用户可改）
    document.getElementById("exif-make").value = EXIF_TEMPLATES.portrait.make;
    document.getElementById("exif-model").value = EXIF_TEMPLATES.portrait.model;
    document.getElementById("exif-lens").value = EXIF_TEMPLATES.portrait.lens;
    document.getElementById("exif-exposure").value = EXIF_TEMPLATES.portrait.exposure;
    document.getElementById("exif-fnumber").value = EXIF_TEMPLATES.portrait.fnumber;
    document.getElementById("exif-iso").value = EXIF_TEMPLATES.portrait.iso;
    document.getElementById("exif-focal").value = EXIF_TEMPLATES.portrait.focal;

    // EXIF 写入按钮
    document.getElementById("btn-exif-write").addEventListener("click", async () => {
        if (cleanSources.length === 0) { alert("请先在第 1 步选择图片"); return; }
        const src = cleanSources[0];   // 对第一张操作
        // 拍摄时间：留空自动用当前时间（与真实拍摄行为一致）
        const dtInput = document.getElementById("exif-datetime").value.trim();
        const datetime = dtInput || (() => {
            const d = new Date();
            const p = (n, l = 2) => String(n).padStart(l, "0");
            return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        })();
        const fields = {
            make: document.getElementById("exif-make").value.trim(),
            model: document.getElementById("exif-model").value.trim(),
            lens: document.getElementById("exif-lens").value.trim(),
            modify: document.getElementById("exif-modify").value.trim() || datetime,
            datetime,
            pixelW: src.canvas.width, pixelH: src.canvas.height,
        };
        // 曝光时间解析：支持 "1/100" 与 "0.01" 两种写法
        const expS = document.getElementById("exif-exposure").value.trim();
        if (expS) {
            const m = expS.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
            fields.exposureSec = m ? (parseFloat(m[1]) / parseFloat(m[2])) : parseFloat(expS);
            if (!isFinite(fields.exposureSec) || fields.exposureSec <= 0) { alert("曝光时间无效（如 1/100 或 0.01）"); return; }
        }
        const fnS = document.getElementById("exif-fnumber").value.trim();
        if (fnS) { const v = parseFloat(fnS); if (!isFinite(v) || v <= 0) { alert("光圈 F 值无效"); return; } fields.fnumber = v; }
        const isoS = document.getElementById("exif-iso").value.trim();
        if (isoS) { const v = parseInt(isoS, 10); if (!isFinite(v) || v <= 0) { alert("ISO 无效"); return; } fields.iso = v; }
        const foS = document.getElementById("exif-focal").value.trim();
        if (foS) { const v = parseFloat(foS); if (!isFinite(v) || v <= 0) { alert("焦距无效"); return; } fields.focal = v; }
        const latS = document.getElementById("exif-lat").value.trim();
        const lonS = document.getElementById("exif-lon").value.trim();
        if (latS) { const v = parseFloat(latS); if (!isFinite(v) || Math.abs(v) > 90) { alert("纬度无效（十进制度，-90~90）"); return; } fields.lat = v; }
        if (lonS) { const v = parseFloat(lonS); if (!isFinite(v) || Math.abs(v) > 180) { alert("经度无效（十进制度，-180~180）"); return; } fields.lon = v; }
        if (!fields.make && !fields.model && !fields.datetime && fields.lat === undefined && fields.lon === undefined) {
            alert("请至少填写一项要写入的信息"); return;
        }
        const btn = document.getElementById("btn-exif-write");
        btn.disabled = true;
        btn.textContent = "⏳ 写入中...";
        try {
            const blob = await injectExifToFile(src.bytes, fields);
            const dot = src.filename.lastIndexOf(".");
            const base = dot > 0 ? src.filename.slice(0, dot) : src.filename;
            const ext = dot > 0 ? src.filename.slice(dot + 1).toLowerCase() : "png";
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${base}_exif.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            const written = [fields.make && "品牌", fields.model && "型号", fields.lens && "镜头", fields.exposureSec !== undefined && "曝光", fields.fnumber !== undefined && "光圈", fields.iso !== undefined && "ISO", fields.focal !== undefined && "焦距", fields.datetime && "时间", fields.lat !== undefined && "GPS"].filter(Boolean).join(" / ");
            document.getElementById("txt-exif-result").textContent =
                `已写入（${written}）并保存为 ${base}_exif.${ext}；用「信息查看」重新导入该文件即可核对`;
        } catch (e) {
            alert("写入失败: " + e.message);
            document.getElementById("txt-exif-result").textContent = "写入失败: " + e.message;
        }
        btn.disabled = false;
        btn.textContent = "✍️ 写入并保存";
    });

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

    // 8.3.1 子面板切换：两页共用的底部子功能切换
    // 图片处理（page-merge）：拼接 / 网格拼接 / 九宫格切图 / 覆盖图片 / 相片处理
    // 图片工具（page-md5）：MD5 哈希 / 图片压缩 / 格式转换
    const mergeSubPanels = {
        merge: document.getElementById("panel-merge-merge"),
        gridmerge: document.getElementById("panel-merge-gridmerge"),
        grid: document.getElementById("panel-merge-grid"),
        overlay: document.getElementById("panel-merge-overlay"),
        idphoto: document.getElementById("panel-merge-idphoto"),
        md5hash: document.getElementById("panel-md5-hash"),
        imgcompress: document.getElementById("panel-img-compress"),
        imgconvert: document.getElementById("panel-img-convert"),
        mirage: document.getElementById("panel-cl-mirage"),
        decode: document.getElementById("panel-cl-decode"),
        advanced: document.getElementById("panel-cl-advanced"),
        encode: document.getElementById("panel-cl-encode")
    };
    // 页面 → 子标签映射（切页时只显示本页的子标签并回到第一项）
    const SUB_TABS_BY_PAGE = {
        "page-merge": ["merge", "gridmerge", "grid", "overlay", "idphoto"],
        "page-md5": ["md5hash", "imgcompress", "imgconvert"],
        "page-classic": ["mirage", "encode", "decode", "advanced"]
    };
    function applySubTabsForPage(targetId) {
        const allowed = SUB_TABS_BY_PAGE[targetId];
        if (!allowed) return null;
        // 子标签匹配键：图片工具/图片处理用 data-sub，经典幻影用 data-clsub
        const attr = targetId === "page-classic" ? "data-clsub" : "data-sub";
        document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(b => {
            const key = b.getAttribute("data-sub") || b.getAttribute("data-clsub");
            b.style.display = allowed.includes(key) ? "" : "none";
            b.classList.toggle("active", key === allowed[0]);
        });
        // 隐藏全部子面板，显示第一个
        Object.entries(mergeSubPanels).forEach(([k, p]) => { p.hidden = k !== allowed[0]; });
        mergeSubMode = allowed[0];
        return allowed[0];
    }
    let mergeSubMode = "merge";
    document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            mergeSubMode = btn.getAttribute("data-sub");
            Object.entries(mergeSubPanels).forEach(([k, p]) => { p.hidden = k !== mergeSubMode; });
        });
    });

    // 8.3.2 九宫格切图：3x3 / 2x2 / 1x3 / 2x3 等分布局，可选先裁方正方形
    const boxGrid = document.getElementById("box-grid-upload");
    const inputGrid = document.getElementById("input-grid-image");
    let gridSourceCanvas = null;
    let gridMode = "square";
    let gridRows = 3, gridCols = 3;
    let gridResults = [];

    boxGrid.addEventListener("click", () => inputGrid.click());
    enableDropUpload(boxGrid, inputGrid);

    // 布局切换：1xN（单行条状）没有"裁正方形"概念，自动禁用裁切选项
    document.querySelectorAll("#grid-layout-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#grid-layout-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            gridRows = parseInt(btn.getAttribute("data-rows"), 10);
            gridCols = parseInt(btn.getAttribute("data-cols"), 10);
            const singleRow = gridRows === 1;
            const sqRow = document.getElementById("row-grid-square");
            sqRow.style.opacity = singleRow ? ".45" : "";
            sqRow.style.pointerEvents = singleRow ? "none" : "";
        });
    });

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
        if (gridMode !== "square" || gridRows === 1) return { sx: 0, sy: 0, sw: w, sh: h };
        const side = Math.min(w, h);
        return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), sw: side, sh: side };
    }

    document.getElementById("btn-grid-run").addEventListener("click", () => {
        if (!gridSourceCanvas) { alert("请先选择一张图片"); return; }
        clearGridResults();
        const { sx, sy, sw, sh } = gridSourceRegion();
        const cw = Math.floor(sw / gridCols), ch = Math.floor(sh / gridRows);
        const total = gridRows * gridCols;
        let done = 0;
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const piece = document.createElement("canvas");
                piece.width = cw;
                piece.height = ch;
                piece.getContext("2d").drawImage(gridSourceCanvas, sx + c * cw, sy + r * ch, cw, ch, 0, 0, cw, ch);
                piece.toBlob(blob => {
                    const filename = `${r * gridCols + c + 1}_grid_${stamp}.png`;
                    gridResults.push({ blob, url: URL.createObjectURL(blob), filename });
                    done++;
                    if (done === total) finishGrid();
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
        const total = gridRows * gridCols;
        document.getElementById("txt-grid-result-title").textContent = `#️⃣ 切图完成 (共 ${total} 张)`;
        list.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
        // 缩略图宽高比与切块一致（单行条状块不再强制正方形）
        list.querySelectorAll("img").forEach(im => { im.style.aspectRatio = `${gridCols} / ${gridRows}`; });
        const squareApplied = gridMode === "square" && gridRows > 1;
        document.getElementById("txt-grid-summary").textContent = squareApplied
            ? `已居中裁成正方形后 ${gridRows}x${gridCols} 等分 | 原图 ${w}x${h} → 每块 ${Math.floor(Math.min(w, h) / gridRows)}px`
            : `原图完整 ${gridRows}x${gridCols} 等分（不裁剪）| ${w}x${h} → 每块 ${Math.floor(w / gridCols)}x${Math.floor(h / gridRows)}`;
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
    const boxMd5Img = document.getElementById("box-md5-img");
    const inputMd5Img = document.getElementById("input-md5-image");
    let md5Items = [];

    // 通用导入：全部进同一份 md5Items（分框只是入口不同）
    async function importMd5Files(files) {
        let added = 0;
        for (const file of files) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                md5Items.push({ file, name: file.name, size: file.size, bytes });
                added++;
            } catch (err) { /* 跳过 */ }
        }
        if (added) { renderMd5List(); refreshMd5Badge(); }
    }

    // 两个框：点击调各自的 input（图片框带 accept="image/*"，手机调相册）
    boxMd5.addEventListener("click", () => inputMd5.click());
    enableDropUpload(boxMd5, inputMd5);
    boxMd5Img.addEventListener("click", () => inputMd5Img.click());
    enableDropUpload(boxMd5Img, inputMd5Img);

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
            resetMd5Box();
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = md5Items.length === 1
            ? `已选 1 个文件`
            : `已选 ${md5Items.length} 个文件`;
    }

    async function importMd5WithHashes(files) {
        for (const file of files) {
            try {
                const buf = new Uint8Array(await file.arrayBuffer());
                const hashes = await computeMd5Hashes(buf);
                md5Items.push({ file, name: file.name, size: file.size, bytes: buf, hashes });
            } catch (err) { /* 单个失败跳过 */ }
        }
        renderMd5List();
        refreshMd5Badge();
    }

    // 两个入口共用同一套导入逻辑；enableDropUpload 会把拖入文件写回各自的 input
    // 并派发 change，因此无论拖到"选择文件"还是"选择图片"框，都会正确识别导入
    inputMd5.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length === 0) return;
        await importMd5WithHashes(files);
    });

    inputMd5Img.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        if (files.length === 0) return;
        await importMd5WithHashes(files);
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

    // 8.6 图片压缩：多图 → 统一 JPG，质量滑条实时预览（rAF 合帧，无编码开销），
    // 体积估算用「绘制→toBlob」仅取 size（弱设备可能掉帧，但展示量级足够）；保存时才正式编码
    const boxCp = document.getElementById("box-cp-upload");
    const inputCp = document.getElementById("input-cp-image");
    let cpItems = [];   // [{ file, name, size, bytes }]
    let cpResults = []; // [{ blob, url, filename, origSize }] 保存用的最终结果（保存时生成）
    let cpDirty = false, cpRaf = 0;

    boxCp.addEventListener("click", () => inputCp.click());
    enableDropUpload(boxCp, inputCp);

    function refreshCpBadge() {
        const badge = document.getElementById("badge-cp-info");
        if (cpItems.length === 0) {
            badge.style.display = "none";
            boxCp.querySelector(".upload-icon").style.display = "";
            boxCp.querySelector(".upload-text").style.display = "";
            boxCp.querySelector(".upload-hint").style.display = "";
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = `已选 ${cpItems.length} 张图片`;
    }

    function renderCpFileList() {
        renderFileList(cpItems, (i) => {
            cpItems.splice(i, 1);
            cpImgCache.splice(i, 1);
            renderCpFileList();
            refreshCpBadge();
            renderCpPreview();
        }, { containerId: "cp-file-list", actionsId: "cp-file-actions" });
    }

    document.getElementById("btn-cp-clearfiles").addEventListener("click", () => {
        cpItems = [];
        cpImgCache = [];
        renderCpFileList();
        refreshCpBadge();
        renderCpPreview();
    });

    const cpQualitySlider = document.getElementById("cp-slider-quality");
    cpQualitySlider.addEventListener("input", () => {
        document.getElementById("cp-val-quality").textContent = Math.round(cpQualitySlider.value * 100) + "%";
        scheduleCpPreview();
    });

    // 压缩方式：仅画质 / 仅尺寸 / 画质+尺寸（都选时先等比缩放再压画质）
    let cpMode = "quality";
    const cpScaleSlider = document.getElementById("cp-slider-scale");
    cpScaleSlider.addEventListener("input", () => {
        document.getElementById("cp-val-scale").textContent = Math.round(cpScaleSlider.value * 100) + "%";
        scheduleCpPreview();
    });
    document.querySelectorAll("#cp-mode-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#cp-mode-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            cpMode = btn.getAttribute("data-cp-mode");
            applyCpModeUI();
            scheduleCpPreview();
        });
    });

    function applyCpModeUI() {
        // 目标体积模式：画质/尺寸滑条都禁用（由算法自动决定）
        const target = cpMode === "target";
        const scaleOn = cpMode === "scale" || cpMode === "both";
        const qualityOn = cpMode === "quality" || cpMode === "both";
        document.getElementById("row-cp-scale").style.opacity = scaleOn ? "" : ".45";
        document.getElementById("row-cp-scale").style.pointerEvents = scaleOn ? "" : "none";
        cpQualitySlider.disabled = !qualityOn;
        document.getElementById("cp-val-quality").style.opacity = qualityOn ? "" : ".45";
        document.getElementById("cp-slider-quality").style.opacity = qualityOn ? "" : ".45";
        const tRow = document.getElementById("row-cp-target");
        tRow.style.opacity = target ? "" : ".45";
        tRow.style.pointerEvents = target ? "" : "none";
        document.getElementById("txt-cp-size-hint").textContent = target
            ? "目标体积：出图不超过目标（按 1024 进制，1KB=1024 字节）；二分画质 + 细步探测贴到 JPEG 台阶沿"
            : (scaleOn
                ? "等比例缩放：宽高同时缩放，不变形；输出仍为 JPG"
                : "只调画质：保持原尺寸像素不变");
    }

    // 读取目标体积（KB/张），非法输入返回 null
    function readCpTargetKB() {
        const v = parseFloat(document.getElementById("input-cp-target").value);
        return (isFinite(v) && v > 0) ? v : null;
    }
    document.getElementById("input-cp-target").addEventListener("input", () => scheduleCpPreview());

    /**
     * 目标体积模式：对一张图（Image）求"不超过目标 KB 的最高画质参数"。
     * 策略：先用小画布粗估画质曲线，再在 0.1~1.0 上二分画质；仍超标则等比降尺寸（10% 步进，最低 30%）。
     * 返回 { quality, scale, size }（size 为估算字节数）
     */
        // JPEG 编码（toBlob 的 Promise 化）——求解与保存共用同一条编码路径，保证体积一致
    function jpegBlob(cv, q) {
        return new Promise(res => cv.toBlob(res, "image/jpeg", q));
    }

    async function solveCpTarget(img, targetKB) {
        const targetBytes = targetKB * 1024;
        const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
        let scale = 1;   // 相对原图的尺寸比例
        let best = null;
        // 直接在"实际输出尺寸"的画布上二分（与保存完全同源），试算体积 = 出图体积
        for (let round = 0; round < 7; round++) {
            const w = Math.max(16, Math.round(w0 * scale));
            const h = Math.max(16, Math.round(h0 * scale));
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h);
            // 二分画质（8 轮，区间 0.1~1.0）
            let lo = 0.1, hi = 1.0, size = 0;
            for (let it = 0; it < 8; it++) {
                const q = (lo + hi) / 2;
                const b = await jpegBlob(cv, q);
                size = b.size;
                if (size <= targetBytes) lo = q; else hi = q;
            }
            const bq = await jpegBlob(cv, lo);
            size = bq.size;
            if (size <= targetBytes) {
                // 细步探测：JPEG 体积-画质是阶梯曲线，二分停在了台阶下沿。
                // 以 0.002 为步长向上爬，把台阶缝隙里的画质吃干净（能贴多少贴多少）
                let q2 = lo, s2 = size;
                for (let step = 0; step < 20; step++) {
                    const probe = Math.min(1.0, q2 + 0.002);
                    if (probe === q2) break;
                    const bp = await jpegBlob(cv, probe);
                    if (bp.size <= targetBytes) { q2 = probe; s2 = bp.size; }
                    else break;
                }
                best = { quality: q2, scale, size: s2 };
                break;   // 当前尺寸下已能达标
            }
            // 画质压到下限还超标 → 降尺寸再试
            scale = Math.max(0.3, scale - 0.1);
        }
        if (!best) {
            const w = Math.max(16, Math.round(w0 * scale)), h = Math.max(16, Math.round(h0 * scale));
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h);
            const b = await jpegBlob(cv, 0.1);
            best = { quality: 0.1, scale, size: b.size };
        }
        return best;
    }
    // 实时预览：竖排大图（每张画压缩后的 JPEG，画质所见即所得）+ 逐张体积对比 + 单删/全删
    async function renderCpPreview() {
        const list = document.getElementById("cp-result-list");
        const card = document.getElementById("card-cp-result");
        const gallery = document.getElementById("cp-preview-gallery");
        const summary = document.getElementById("txt-cp-summary");
        if (cpItems.length === 0) {
            card.style.display = "none";
            list.innerHTML = "";
            gallery.innerHTML = "";
            return;
        }
        card.style.display = "block";
        list.innerHTML = "";
        gallery.innerHTML = "";
        const quality = cpMode === "scale" ? 1.0 : parseFloat(cpQualitySlider.value);
        const scaleFactor = (cpMode === "quality" || cpMode === "target") ? 1 : parseFloat(cpScaleSlider.value);
        const targetKB = cpMode === "target" ? readCpTargetKB() : null;
        let origTotal = 0, newTotal = 0;
        for (const [i, item] of cpItems.entries()) {
            const img = cpImgCache[i];
            let newSize = item.size;
            if (img) {
                // 预览画布：目标像素 = 原尺寸 × 等比缩放；再限制 ≤480 宽用于展示
                const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
                const sol = cpMode === "target" ? await solveCpTarget(img, targetKB || 500) : null;
                const effScale = cpMode === "target" ? sol.scale : scaleFactor;
                const targetW = Math.max(1, Math.round(w0 * effScale));
                const targetH = Math.max(1, Math.round(h0 * effScale));
                const k = Math.min(1, 480 / targetW);
                const cv = document.createElement("canvas");
                cv.width = Math.max(1, Math.round(targetW * k));
                cv.height = Math.max(1, Math.round(targetH * k));
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                const effQ = cpMode === "target" ? sol.quality : quality;
                const dataUrl = cv.toDataURL("image/jpeg", effQ);
                if (cpMode === "target") {
                    // 目标体积模式：sol.size 是全尺寸真实编码体积，直接采用（预览缩略图仅作画质示意）
                    newSize = sol.size;
                } else {
                    newSize = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
                    if (k < 1) newSize = Math.round(newSize / (k * k));   // 体积与像素量近似线性，回折到目标尺寸量级
                }

                const itemEl = document.createElement("div");
                itemEl.className = "cp-preview-item";
                const im = document.createElement("img");
                im.src = dataUrl;
                im.alt = item.name;
                const dimChanged = targetW !== w0 || targetH !== h0;
                const saved = item.size > 0 ? Math.max(0, Math.round((1 - newSize / item.size) * 100)) : 0;
                itemEl.innerHTML = `<div class="cp-preview-label"><span>${i + 1}. ${item.name}</span>` +
                    (dimChanged ? `<span style="color: var(--primary);">${w0}×${h0} → ${targetW}×${targetH}</span>` : "") +
                    `<span>${(item.size / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB（${newSize.toLocaleString()} 字节）</span>` +
                    `<b>${saved > 0 ? "省" + saved + "%" : "—"}</b></div>`;
                const del = document.createElement("button");
                del.className = "cp-preview-del";
                del.textContent = "✕";
                del.title = "从预览中移除";
                del.addEventListener("click", () => {
                    cpItems.splice(i, 1);
                    cpImgCache.splice(i, 1);
                    renderCpPreview();
                    const badge = document.getElementById("badge-cp-info");
                    badge.textContent = cpItems.length ? `已选 ${cpItems.length} 张图片` : "";
                    if (!cpItems.length) badge.style.display = "none";
                });
                itemEl.insertBefore(im, itemEl.firstChild);
                itemEl.appendChild(del);
                gallery.appendChild(itemEl);
            }
            origTotal += item.size; newTotal += newSize;
            const saved = item.size > 0 ? Math.max(0, Math.round((1 - newSize / item.size) * 100)) : 0;
            const row = document.createElement("div");
            row.className = "md5-item";
            row.innerHTML = `<div class="md5-item-head"><span class="md5-hash-name">${item.name}</span>` +
                `<span style="color: ${newSize < item.size ? "var(--success)" : "var(--text-faint)"};">` +
                `${(item.size / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB（省 ${saved}%）</span></div>`;
            list.appendChild(row);
        }
        document.getElementById("txt-cp-live").textContent = cpMode === "target"
            ? `已选 ${cpItems.length} 张 · 目标 ${targetKB || "?"}KB/张`
            : `已选 ${cpItems.length} 张 · 画质 ${Math.round(quality * 100)}%` +
              (cpMode !== "quality" ? ` · 尺寸 ${Math.round(scaleFactor * 100)}%` : "");
        if (cpMode === "target") {
            summary.textContent = `目标体积模式（出图不超过目标，预览即最终体积）| 总计 ${(origTotal / 1024 / 1024).toFixed(2)}MB → ${(newTotal / 1024 / 1024).toFixed(2)}MB`;
        } else {
            summary.textContent = `实时预览（缩略为画质示意，保存按设置的高清压缩）| 总计 ${(origTotal / 1024 / 1024).toFixed(2)}MB → ~${(newTotal / 1024 / 1024).toFixed(2)}MB` +
                (newTotal < origTotal ? `（省 ${Math.round((1 - newTotal / origTotal) * 100)}%）` : "（当前设置体积增大，建议降低画质或尺寸）");
        }
    }

    // 缓存已解码 Image（避免滑条拖动时反复解码源文件）
    let cpImgCache = [];
    function scheduleCpPreview() {
        cpDirty = true;
        if (!cpRaf) cpRaf = requestAnimationFrame(() => {
            cpRaf = 0;
            if (!cpDirty) return;
            cpDirty = false;
            renderCpPreview();
        });
    }

    // 清空全部预览
    document.getElementById("btn-cp-clear").addEventListener("click", () => {
        cpItems = [];
        cpImgCache = [];
        renderCpPreview();
        document.getElementById("badge-cp-info").style.display = "none";
    });

    document.getElementById("btn-cp-download").addEventListener("click", async () => {
        if (cpItems.length === 0) { alert("请先选择图片"); return; }
        const quality = cpMode === "scale" ? 1.0 : parseFloat(cpQualitySlider.value);
        const scaleFactor = (cpMode === "quality" || cpMode === "target") ? 1 : parseFloat(cpScaleSlider.value);
        const targetKB = cpMode === "target" ? readCpTargetKB() : null;
        const btn = document.getElementById("btn-cp-download");
        btn.disabled = true;
        btn.textContent = "⏳ 高清压缩中...";
        let done = 0;
        (async () => {
        for (const [i, item] of cpItems.entries()) {
            const img = new Image();
            img.src = URL.createObjectURL(new Blob([item.bytes]));
            await new Promise(res => { img.onload = res; img.onerror = res; });
            {
                let q = quality, sc = scaleFactor;
                if (cpMode === "target") {
                    const sol = await solveCpTarget(img, targetKB);
                    q = sol.quality; sc = sol.scale;
                }
                const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
                const cv = document.createElement("canvas");
                cv.width = Math.max(1, Math.round(w0 * sc));
                cv.height = Math.max(1, Math.round(h0 * sc));
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                cv.toBlob(blob => {
                    if (blob) {
                        const dot = item.name.lastIndexOf(".");
                        const base = dot > 0 ? item.name.slice(0, dot) : item.name;
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = cpMode === "target"
                            ? `${base}_${targetKB}kb.jpg`
                            : (scaleFactor < 1 ? `${base}_${Math.round(scaleFactor * 100)}percent.jpg` : `${base}_compressed.jpg`);
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }
                    done++;
                    if (done === cpItems.length) {
                        btn.disabled = false;
                        btn.textContent = "💾 一键保存全部";
                    }
                }, "image/jpeg", q);
            }
        }
        })();
    });

    inputCp.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        cpItems = [];
        cpImgCache = [];
        for (const file of files) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                cpItems.push({ file, name: file.name, size: file.size, bytes });
                // 预解码进缓存（选图时一次性成本）
                const img = await loadImage(URL.createObjectURL(file));
                cpImgCache[cpItems.length - 1] = img;
            } catch (err) { /* 跳过 */ }
        }
        const badge = document.getElementById("badge-cp-info");
        badge.style.display = "block";
        badge.textContent = `已选 ${cpItems.length} 张图片`;
        renderCpFileList();
        renderCpPreview();
    });

    // 8.7 格式转换：PNG/JPG/WEBP 互转
    const boxCv = document.getElementById("box-cv-upload");
    const inputCv = document.getElementById("input-cv-image");
    let cvItems = [];
    let cvResults = [];
    let cvFormat = "jpeg";

    boxCv.addEventListener("click", () => inputCv.click());
    enableDropUpload(boxCv, inputCv);

    // 已选文件列表（选图即显示，✕ 移除单个，全部移除按钮）
    function renderCvFileList() {
        renderFileList(cvItems, (i) => {
            cvItems.splice(i, 1);
            renderCvFileList();
            refreshCvBadge();
        }, { containerId: "cv-file-list", actionsId: "cv-file-actions" });
    }

    function refreshCvBadge() {
        const badge = document.getElementById("badge-cv-info");
        if (cvItems.length === 0) {
            badge.style.display = "none";
            boxCv.querySelector(".upload-icon").style.display = "";
            boxCv.querySelector(".upload-text").style.display = "";
            boxCv.querySelector(".upload-hint").style.display = "";
            return;
        }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = `已选 ${cvItems.length} 张图片`;
    }

    document.getElementById("btn-cv-clearfiles").addEventListener("click", () => {
        cvItems = [];
        renderCvFileList();
        refreshCvBadge();
    });

    const cvQualitySlider = document.getElementById("cv-slider-quality");
    cvQualitySlider.addEventListener("input", () => {
        document.getElementById("cv-val-quality").textContent = Math.round(cvQualitySlider.value * 100) + "%";
    });
    document.querySelectorAll("#cv-format-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#cv-format-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            cvFormat = btn.getAttribute("data-fmt");
            // PNG 无损无质量参数，画质滑条仅对 JPG/WEBP 有意义
            document.getElementById("row-cv-quality").style.opacity = cvFormat === "png" ? ".45" : "";
            document.getElementById("row-cv-quality").style.pointerEvents = cvFormat === "png" ? "none" : "";
        });
    });

    // 转换结果列表（MD5 同款交互）：单条保存 / ✕ 移除；卡片头有清空全部
    function renderCvResults() {
        const list = document.getElementById("cv-result-list");
        list.innerHTML = "";
        cvResults.forEach((r, i) => {
            const row = document.createElement("div");
            row.className = "md5-item";
            const head = document.createElement("div");
            head.className = "md5-item-head";
            head.innerHTML = `<span class="md5-hash-name">${r.filename}</span>` +
                `<span style="color: var(--text-faint);">${(r.origSize / 1024).toFixed(0)}KB → ${(r.blob.size / 1024).toFixed(0)}KB</span>`;
            const saveBtn = document.createElement("button");
            saveBtn.className = "md5-item-del";
            saveBtn.textContent = "💾";
            saveBtn.title = "保存这个";
            saveBtn.addEventListener("click", () => {
                const a = document.createElement("a");
                a.href = r.url;
                a.download = r.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            });
            const del = document.createElement("button");
            del.className = "md5-item-del";
            del.textContent = "✕";
            del.title = "从列表移除";
            del.addEventListener("click", () => {
                URL.revokeObjectURL(r.url);
                cvResults.splice(i, 1);
                renderCvResults();
            });
            head.appendChild(saveBtn);
            head.appendChild(del);
            row.appendChild(head);
            list.appendChild(row);
        });
    }

    // 清空全部转换结果
    document.getElementById("btn-cv-clear").addEventListener("click", () => {
        cvResults.forEach(r => URL.revokeObjectURL(r.url));
        cvResults = [];
        renderCvResults();
        document.getElementById("card-cv-result").style.display = "none";
    });

    document.getElementById("btn-cv-convert").addEventListener("click", async () => {
        if (cvItems.length === 0) { alert("请先选择图片"); return; }
        const btn = document.getElementById("btn-cv-convert");
        btn.disabled = true;
        btn.textContent = "⏳ 转换中...";
        cvResults.forEach(r => URL.revokeObjectURL(r.url));
        cvResults = [];
        const quality = parseFloat(cvQualitySlider.value);
        const mime = cvFormat === "png" ? "image/png" : (cvFormat === "webp" ? "image/webp" : "image/jpeg");

        for (const item of cvItems) {
            const img = await loadImage(URL.createObjectURL(new Blob([item.bytes])));
            const cv = document.createElement("canvas");
            cv.width = img.naturalWidth || img.width;
            cv.height = img.naturalHeight || img.height;
            const ctx = cv.getContext("2d");
            // PNG→JPG：透明区域按开关填白/黑（JPG 无透明通道）
            if (cvFormat === "jpeg") {
                ctx.fillStyle = document.getElementById("chk-cv-whitebg").checked ? "#FFFFFF" : "#000000";
                ctx.fillRect(0, 0, cv.width, cv.height);
            }
            ctx.drawImage(img, 0, 0);
            const blob = await new Promise(res => cv.toBlob(res, mime, quality));
            if (!blob) continue;
            const dot = item.name.lastIndexOf(".");
            const base = dot > 0 ? item.name.slice(0, dot) : item.name;
            const ext = cvFormat === "jpeg" ? "jpg" : cvFormat;
            cvResults.push({
                blob,
                url: URL.createObjectURL(blob),
                filename: `${base}.${ext}`,
                origSize: item.size
            });
        }

        renderCvResults();
        document.getElementById("card-cv-result").style.display = "block";
        btn.disabled = false;
        btn.textContent = "🔄 开始转换";
    });

    document.getElementById("btn-cv-download").addEventListener("click", () => {
        cvResults.forEach((r, i) => {
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

    inputCv.addEventListener("change", async (e) => {
        const files = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = "";
        for (const file of files) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                cvItems.push({ file, name: file.name, size: file.size, bytes });
            } catch (err) { /* 跳过 */ }
        }
        renderCvFileList();
        refreshCvBadge();
    });

    function resetMd5Box() {
        [boxMd5, boxMd5Img].forEach(box => {
            box.querySelector(".upload-icon").style.display = "";
            box.querySelector(".upload-text").style.display = "";
            box.querySelector(".upload-hint").style.display = "";
        });
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

    
    // 8.8 经典幻影：黑白幻影坦克（灰度里表图按占比混合，参考 Mirage_Cloak Encoder_v4）
    // 原理：里图缩放转灰度取 li = 灰度×里占比；表图居中裁剪到同尺寸取 lc = 255-(255-表灰)×表占比；
    //       alpha = 255 - lc + li；R=G=B = li×255/alpha。QQ 气泡（浅底）显表图、点开（深底）显里图。
    // 头 4 像素写标记 114,114,114,255（与原版一致，供识别）。
    const boxClInner = document.getElementById("box-cl-inner");
    const inputClInner = document.getElementById("input-cl-inner");
    const boxClCover = document.getElementById("box-cl-cover");
    const inputClCover = document.getElementById("input-cl-cover");
    let clInnerCanvas = null;    // 里图 canvas（已缩放+灰度化）
    let clCoverCanvas = null;    // 表图 canvas（已居中裁剪+缩放+灰度化）
    let clInnerName = "", clCoverName = "";
    let clInnerFile = null, clCoverFile = null;   // 原始 File（长边变化时重缩放用）

    boxClInner.addEventListener("click", () => inputClInner.click());
    enableDropUpload(boxClInner, inputClInner);
    boxClCover.addEventListener("click", () => inputClCover.click());
    enableDropUpload(boxClCover, inputClCover);

    const clSizeSlider = document.getElementById("cl-slider-size");
    clSizeSlider.addEventListener("input", () => {
        document.getElementById("cl-val-size").textContent = clSizeSlider.value;
        // 长边变化需要重缩放两图（懒重载：存原始 File 重新走 clLoadImage）
        if (clInnerFile) clReloadInner();
        if (clCoverFile) clReloadCover();
    });
    const clInnerSlider = document.getElementById("cl-slider-inner");
    clInnerSlider.addEventListener("input", () => {
        document.getElementById("cl-val-inner").textContent = Math.round(clInnerSlider.value * 100) + "%";
        scheduleClPreview();
    });
    const clCoverSlider = document.getElementById("cl-slider-cover");
    clCoverSlider.addEventListener("input", () => {
        document.getElementById("cl-val-cover").textContent = Math.round(clCoverSlider.value * 100) + "%";
        scheduleClPreview();
    });

    // 单图导入：缩放到"长边=滑条值"并转灰度
    async function clReloadInner() {
        if (!clInnerFile) return;
        const r = await clLoadImage(clInnerFile, true);
        clInnerCanvas = r.canvas;
    }
    async function clReloadCover() {
        if (!clCoverFile) return;
        const r = await clLoadImage(clCoverFile, false);
        clCoverCanvas = r.canvas;
    }

    async function clLoadImage(file, isInner) {
        const img = await loadImage(URL.createObjectURL(file));
        const size = parseInt(clSizeSlider.value, 10);
        const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
        let w, h;
        if (w0 >= h0) { w = size; h = Math.max(1, Math.round(h0 * size / w0)); }
        else { h = size; w = Math.max(1, Math.round(w0 * size / h0)); }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        // 灰度化（与原版相同加权）
        const idata = ctx.getImageData(0, 0, w, h);
        const d = idata.data;
        for (let i = 0; i < d.length; i += 4) {
            const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            d[i] = d[i + 1] = d[i + 2] = gray;
        }
        ctx.putImageData(idata, 0, 0);
        return { canvas: cv, w, h };
    }

    // 表图居中裁剪到里图宽高比（与原版 updateCoverImage 一致）
    function clFitCover(img, tarW, tarH) {
    // 标准居中裁剪（与原版 resizeCover 等效）：源图裁出与目标同比例的最大内接矩形再缩放。
    // 注意：sx/sy/sw/sh 全部在源图坐标系计算——之前混用目标坐标系导致大图裁剪错位（表图缩在角落）。
    const srcW = img.width, srcH = img.height;
    const srcRatio = srcW / srcH, tarRatio = tarW / tarH;
    let sx, sy, sw, sh;
    if (srcRatio > tarRatio) {
        sh = srcH; sw = srcH * tarRatio;
        sx = (srcW - sw) / 2; sy = 0;
    } else {
        sw = srcW; sh = srcW / tarRatio;
        sx = 0; sy = (srcH - sh) / 2;
    }
    const cv = document.createElement("canvas");
    cv.width = tarW; cv.height = tarH;
    cv.getContext("2d", { willReadFrequently: true }).drawImage(img, sx, sy, sw, sh, 0, 0, tarW, tarH);
    return cv;
}

    let clRaf = 0;
    function scheduleClPreview() {
        if (clRaf) return;
        clRaf = requestAnimationFrame(() => { clRaf = 0; renderClPreview(); });
    }

    // 实时预览：两图齐后按当前参数混合
    function renderClPreview() {
        const card = document.getElementById("card-cl-result");
        const summary = document.getElementById("txt-cl-summary");
        const frame = document.querySelector("#card-cl-result .merge-preview-frame");
        const outCv = document.getElementById("canvas-cl-out");
        if (!clInnerCanvas || !clCoverCanvas) {
            card.style.display = "none";
            return;
        }
        card.style.display = "block";
        const w = clInnerCanvas.width, h = clInnerCanvas.height;
        // 表图裁剪到里图比例
        const coverFit = clFitCover(clCoverCanvas, w, h);
        const innerCtx = clInnerCanvas.getContext("2d");
        const coverCtx = coverFit.getContext("2d");
        const innerData = innerCtx.getImageData(0, 0, w, h).data;
        const coverData = coverCtx.getImageData(0, 0, w, h).data;
        const outC = document.createElement("canvas");
        outC.width = w; outC.height = h;
        const octx = outC.getContext("2d");
        const outImg = octx.createImageData(w, h);
        const od = outImg.data;
        const si = parseFloat(clInnerSlider.value);
        const sc = parseFloat(clCoverSlider.value);
        for (let i = 0; i < innerData.length; i += 4) {
            const li = Math.floor(innerData[i] * si);
            const lc = Math.floor(255 - (255 - coverData[i]) * sc);
            const a = 255 - lc + li;
            const g = a > 0 ? Math.floor((li * 255) / a) : 0;
            od[i] = od[i + 1] = od[i + 2] = g;
            od[i + 3] = a;
        }
        // 头 4 像素标记（与原版一致）
        od[0] = 114; od[1] = 114; od[2] = 114; od[3] = 255;
        octx.putImageData(outImg, 0, 0);
        // 展示
        outCv.width = w; outCv.height = h;
        outCv.getContext("2d").drawImage(outC, 0, 0);
        outCv.hidden = false;
        frame.hidden = false;
        summary.textContent = `输出 ${w}x${h} | 里占比 ${Math.round(si * 100)}% · 表占比 ${Math.round(sc * 100)}%`;
    }

    document.getElementById("btn-cl-run").addEventListener("click", async () => {
        if (!clInnerCanvas || !clCoverCanvas) { alert("请先选择里图和表图"); return; }
        renderClPreview();
        const w = clInnerCanvas.width, h = clInnerCanvas.height;
        document.getElementById("txt-cl-summary").textContent = `已生成 ${w}x${h}，点保存导出 PNG`;
    });

    document.getElementById("btn-cl-download").addEventListener("click", () => {
        const outCv = document.getElementById("canvas-cl-out");
        if (outCv.hidden || !outCv.width) { alert("请先生成"); return; }
        outCv.toBlob(blob => {
            const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `classic_${stamp}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, "image/png");
    });

    inputClInner.addEventListener("change", async (e) => {
        const f = e.target.files ? e.target.files[0] : null;
        e.target.value = "";
        if (!f) return;
        try {
            clInnerFile = f;
            const r = await clLoadImage(f, true);
            clInnerCanvas = r.canvas;
            clInnerName = f.name;
            const pv = document.getElementById("img-cl-inner");
            pv.src = clInnerCanvas.toDataURL("image/jpeg", 0.9);
            pv.style.display = "block";
            boxClInner.querySelector(".upload-icon").style.display = "none";
            boxClInner.querySelector(".upload-text").style.display = "none";
            boxClInner.querySelector(".upload-hint").style.display = "none";
            refreshClBadge();
            scheduleClPreview();
        } catch (err) { alert("里图加载失败: " + err.message); }
    });

    inputClCover.addEventListener("change", async (e) => {
        const f = e.target.files ? e.target.files[0] : null;
        e.target.value = "";
        if (!f) return;
        try {
            clCoverFile = f;
            const r = await clLoadImage(f, false);
            clCoverCanvas = r.canvas;
            clCoverName = f.name;
            const pv = document.getElementById("img-cl-cover");
            pv.src = clCoverCanvas.toDataURL("image/jpeg", 0.9);
            pv.style.display = "block";
            boxClCover.querySelector(".upload-icon").style.display = "none";
            boxClCover.querySelector(".upload-text").style.display = "none";
            boxClCover.querySelector(".upload-hint").style.display = "none";
            refreshClBadge();
            scheduleClPreview();
        } catch (err) { alert("表图加载失败: " + err.message); }
    });

    function refreshClBadge() {
        const badge = document.getElementById("badge-cl-info");
        const parts = [];
        if (clInnerName) parts.push(`里图 ${clInnerName} (${clInnerCanvas.width}x${clInnerCanvas.height})`);
        if (clCoverName) parts.push(`表图 ${clCoverName} (${clCoverCanvas.width}x${clCoverCanvas.height})`);
        if (parts.length === 0) { badge.style.display = "none"; return; }
        badge.style.display = "block";
        badge.style.color = "";
        badge.textContent = parts.join(" ｜ ");
    }

    // ===== 8.8.1 经典幻影子标签切换（复用 merge-sub-tabs 容器，data-clsub 标识） =====
    document.querySelectorAll('#merge-sub-tabs .segmented-btn[data-clsub]').forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#merge-sub-tabs .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            const sub = btn.getAttribute("data-clsub");
            document.querySelectorAll("#page-classic .merge-sub-panel").forEach(p => { p.hidden = p.id !== "panel-cl-" + sub; });
        });
    });

    // ===== 8.9b 光棱制作（Prism Encode，里表双图阈值棋盘混合） =====
    const boxPeInner = document.getElementById("box-pe-inner");
    const inputPeInner = document.getElementById("input-pe-inner");
    const boxPeCover = document.getElementById("box-pe-cover");
    const inputPeCover = document.getElementById("input-pe-cover");
    let peInnerImg = null, peCoverImg = null;   // 原始 Image
    let peInnerName = "", peCoverName = "";

    boxPeInner.addEventListener("click", () => inputPeInner.click());
    enableDropUpload(boxPeInner, inputPeInner);
    boxPeCover.addEventListener("click", () => inputPeCover.click());
    enableDropUpload(boxPeCover, inputPeCover);

    const peInnerSlider = document.getElementById("pe-slider-inner");
    peInnerSlider.addEventListener("input", () => {
        document.getElementById("pe-val-inner").textContent = peInnerSlider.value;
    });
    const peCoverSlider = document.getElementById("pe-slider-cover");
    peCoverSlider.addEventListener("input", () => {
        document.getElementById("pe-val-cover").textContent = peCoverSlider.value;
    });
    let peBlend = { slope: -1, gap: 1, isRow: false };   // 默认斜纹╱
    document.querySelectorAll("#pe-blend-group .segmented-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#pe-blend-group .segmented-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            peBlend = {
                slope: parseInt(btn.getAttribute("data-slope"), 10),
                gap: parseInt(btn.getAttribute("data-gap"), 10),
                isRow: btn.getAttribute("data-row") === "1"
            };
        });
    });

    // 表图居中裁剪（与经典幻影同逻辑）
    function peFitCover(img, w, h) {
    // 标准居中裁剪：源图裁出与目标同比例的最大内接矩形（源图坐标系计算），再缩放绘制到 w×h。
    const srcW = img.width, srcH = img.height;
    const srcRatio = srcW / srcH, tarRatio = w / h;
    let sx, sy, sw, sh;
    if (srcRatio > tarRatio) {
        // 源更宽：全高参与，裁两侧
        sh = srcH; sw = srcH * tarRatio;
        sx = (srcW - sw) / 2; sy = 0;
    } else {
        // 源更高：全宽参与，裁上下
        sw = srcW; sh = srcW / tarRatio;
        sx = 0; sy = (srcH - sh) / 2;
    }
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return cv;
}

    // 棋盘遮罩判定（与 Mirage_Decode encodeIsCover 一致；slope 负数 = 反方向）
    function peIsCover(x, y, slope, gap, isRow) {
        const s = Math.abs(slope);
        if (slope === 0) return (isRow ? y : x) % (gap + 1) < gap;
        if (isRow) return (y / s + x) % (gap + 1) < gap;
        return (x / s + y) % (gap + 1) < gap;
    }

    document.getElementById("btn-pe-run").addEventListener("click", () => {
        if (!peInnerImg || !peCoverImg) { alert("请先选择里图和表图"); return; }
        const innerT = parseInt(peInnerSlider.value, 10);
        const coverT = parseInt(peCoverSlider.value, 10);
        const isInnerGray = document.getElementById("chk-pe-inner-gray").checked;
        const isCoverGray = document.getElementById("chk-pe-cover-gray").checked;
        const isReverse = document.getElementById("chk-pe-reverse").checked;
        // 与原版 Mirage_Decode 一致：成品尺寸 = 里图尺寸（里图不裁剪），
        // 表图 resizeCover 居中裁剪到里图尺寸（被裁的是表图）。
        // 里图先按"最大长或宽"等比缩放（resizeFit 语义，9999 = 不限制）。
        const maxSize = parseInt(document.getElementById("pe-num-maxsize").value, 10) || 9999;
        let iw = peInnerImg.width, ih = peInnerImg.height;
        if (Math.max(iw, ih) > maxSize) {
            const k = maxSize / Math.max(iw, ih);
            iw = Math.max(1, Math.round(iw * k));
            ih = Math.max(1, Math.round(ih * k));
        }
        const w = iw, h = ih;
        // 里图等比缩放到 w×h（不裁剪）
        const cvI = document.createElement("canvas");
        cvI.width = w; cvI.height = h;
        cvI.getContext("2d").drawImage(peInnerImg, 0, 0, w, h);
        // 表图居中裁剪缩放到 w×h
        const cvC = peFitCover(peCoverImg, w, h);
        const innerData = cvI.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
        const coverData = cvC.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
        // 灰度化
        for (const d of [innerData.data, coverData.data]) { /* 由开关在下面处理 */ }
        if (isInnerGray) {
            const d = innerData.data;
            for (let i = 0; i < d.length; i += 4) {
                const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                d[i] = d[i + 1] = d[i + 2] = g;
            }
        }
        if (isCoverGray) {
            const d = coverData.data;
            for (let i = 0; i < d.length; i += 4) {
                const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                d[i] = d[i + 1] = d[i + 2] = g;
            }
        }
        const out = new ImageData(w, h);
        for (let i = 0, x = 0, y = 0; i < innerData.data.length; i += 4) {
            const isCover = peIsCover(x, y, peBlend.slope, peBlend.gap, peBlend.isRow);
            if (isCover) {
                const r = coverData.data[i], g = coverData.data[i + 1], b = coverData.data[i + 2], a = coverData.data[i + 3];
                out.data[i] = isReverse ? Math.floor((r * (255 - coverT)) / 255) : Math.floor(coverT + (r * (255 - coverT)) / 255);
                out.data[i + 1] = isReverse ? Math.floor((g * (255 - coverT)) / 255) : Math.floor(coverT + (g * (255 - coverT)) / 255);
                out.data[i + 2] = isReverse ? Math.floor((b * (255 - coverT)) / 255) : Math.floor(coverT + (b * (255 - coverT)) / 255);
                out.data[i + 3] = a;
            } else {
                const r = innerData.data[i], g = innerData.data[i + 1], b = innerData.data[i + 2], a = innerData.data[i + 3];
                out.data[i] = isReverse ? Math.floor(255 - innerT + (r * innerT) / 255) : Math.floor((r * innerT) / 255);
                out.data[i + 1] = isReverse ? Math.floor(255 - innerT + (g * innerT) / 255) : Math.floor((g * innerT) / 255);
                out.data[i + 2] = isReverse ? Math.floor(255 - innerT + (b * innerT) / 255) : Math.floor((b * innerT) / 255);
                out.data[i + 3] = a;
            }
            x++;
            if (x >= w) { x = 0; y++; }
        }
        const cv = document.getElementById("canvas-pe-out");
        cv.width = w; cv.height = h;
        cv.getContext("2d").putImageData(out, 0, 0);
        cv.hidden = false;
        document.getElementById("card-pe-result").style.display = "block";
        document.getElementById("txt-pe-summary").textContent =
            `里阈值 ${innerT} · 表阈值 ${coverT} | ${w}x${h} | 验证：黑底看里图、白底看表图`;
    });

    document.getElementById("btn-pe-download").addEventListener("click", () => {
        const cv = document.getElementById("canvas-pe-out");
        if (cv.hidden) { alert("请先生成"); return; }
        cv.toBlob(blob => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `prism_encode_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, "image/png");
    });

    inputPeInner.addEventListener("change", async (e) => {
        const f = e.target.files ? e.target.files[0] : null;
        e.target.value = "";
        if (!f) return;
        peInnerImg = await loadImage(URL.createObjectURL(f));
        peInnerName = f.name;
        const pv = document.getElementById("img-pe-inner");
        pv.src = peInnerImg instanceof Image ? peInnerImg.src : peInnerImg.toDataURL("image/jpeg", 0.9);
        pv.style.display = "block";
        boxPeInner.querySelector(".upload-icon").style.display = "none";
        boxPeInner.querySelector(".upload-text").style.display = "none";
        boxPeInner.querySelector(".upload-hint").style.display = "none";
        const badge = document.getElementById("badge-pe-info");
        badge.style.display = "block";
        badge.textContent = `里图 ${f.name} ｜ ` + (peCoverName ? `表图 ${peCoverName}` : "待选表图");
    });

    inputPeCover.addEventListener("change", async (e) => {
        const f = e.target.files ? e.target.files[0] : null;
        e.target.value = "";
        if (!f) return;
        peCoverImg = await loadImage(URL.createObjectURL(f));
        peCoverName = f.name;
        const pv = document.getElementById("img-pe-cover");
        pv.src = peCoverImg instanceof Image ? peCoverImg.src : peCoverImg.toDataURL("image/jpeg", 0.9);
        pv.style.display = "block";
        boxPeCover.querySelector(".upload-icon").style.display = "none";
        boxPeCover.querySelector(".upload-text").style.display = "none";
        boxPeCover.querySelector(".upload-hint").style.display = "none";
        const badge = document.getElementById("badge-pe-info");
        badge.style.display = "block";
        badge.textContent = (peInnerName ? `里图 ${peInnerName} ｜ ` : "") + `表图 ${f.name}`;
    });

    // ===== 8.9 光棱解码（Prism Decode：双阈值窗口 + 对比度 + 迭代扩散） =====
const boxPd = document.getElementById("box-pd-upload");
const inputPd = document.getElementById("input-pd-upload");
let pdCanvas = null;
let pdSrcCache = null;   // 源图 ImageData 缓存（导入后取一次，拖动中不再重复 getImageData）
const pdLow = document.getElementById("pd-slider-low");
const pdHigh = document.getElementById("pd-slider-high");
const pdContrast = document.getElementById("pd-slider-contrast");
const pdIterSlider = document.getElementById("pd-slider-iterations");
let pdRaf = 0;

boxPd.addEventListener("click", () => inputPd.click());
enableDropUpload(boxPd, inputPd);

function pdSyncSliders(changed) {
    let lo = parseInt(pdLow.value, 10), hi = parseInt(pdHigh.value, 10);
    if (lo >= hi) {
        if (changed === "low") hi = lo + 1; else lo = Math.max(0, hi - 1);
        pdHigh.value = String(hi); pdLow.value = String(lo);
    }
    document.getElementById("pd-num-low").value = pdLow.value;
    document.getElementById("pd-num-high").value = pdHigh.value;
    document.getElementById("pd-num-contrast").value = pdContrast.value;
    document.getElementById("pd-num-iterations").value = pdIterSlider.value;
    schedulePdRender();
}
pdLow.addEventListener("input", () => pdSyncSliders("low"));
pdHigh.addEventListener("input", () => pdSyncSliders("high"));
pdContrast.addEventListener("input", () => pdSyncSliders("contrast"));
pdIterSlider.addEventListener("input", () => pdSyncSliders("iterations"));
document.getElementById("pd-reset-contrast").addEventListener("click", () => { pdContrast.value = "0"; pdSyncSliders("contrast"); });
// 手动数值输入框 ↔ 滑条双向绑定
function pdBindNum(numId, sliderId) {
    const num = document.getElementById(numId);
    const slider = document.getElementById(sliderId);
    num.addEventListener("input", () => {
        let v = parseInt(num.value, 10);
        if (isNaN(v)) return;
        v = Math.max(parseInt(num.min, 10), Math.min(parseInt(num.max, 10), v));
        slider.value = String(v);
        pdSyncSliders(sliderId === "pd-slider-low" ? "low" : sliderId === "pd-slider-high" ? "high" : sliderId === "pd-slider-contrast" ? "contrast" : "iterations");
    });
}
pdBindNum("pd-num-low", "pd-slider-low");
pdBindNum("pd-num-high", "pd-slider-high");
pdBindNum("pd-num-contrast", "pd-slider-contrast");
pdBindNum("pd-num-iterations", "pd-slider-iterations");

let pdMethod = "ltavg";
document.querySelectorAll("#pd-method-group .segmented-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#pd-method-group .segmented-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        pdMethod = btn.getAttribute("data-pdm");
        if (pdCanvas) schedulePdRender();
    });
});

// ---- 自动调参：灰度直方图找主峰 ----
    function autoDetectThresholds(data) {
    // 策略（与原版 Mirage_Decode 实测行为一致）：幻影图里表内容各占约一半，
    // 窗口上限 = 灰度直方图累计 50%（中位数）位置——正好卡在里图区域上沿；下限固定 0。
    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
        const l = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        hist[l]++;
    }
    const total = data.length / 4;
    const half = total / 2;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= half) return { lower: 0, higher: i, peak: i };
    }
    return { lower: 0, higher: 24, peak: 0 };
}

// ===== 8.9c 光棱解码 WebGL2 加速（照 Mirage_Decode webgl/decode.ts + helper.ts 移植） =====
// 离屏 WebGL2 canvas：scaleFS（阈值窗口一遍）+ fillFS（24邻扩散，每轮一个 pass，ping-pong 纹理）。
// 常驻缓存 VAO/纹理/FBO；WebGL2 不可用 → pdGlFallback = true 回退 CPU 队列版。
const PD_GLSL_VS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = vec2(a_texCoord.x, a_texCoord.y);
}`;
const PD_GLSL_SCALE = `#version 300 es
precision highp float;
in vec2 v_texCoord;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMask;
uniform sampler2D u_texture;
uniform int u_fillMethod; // 0: black, 1: white, 2: transparent, 3: ltavg(暂黑)
uniform float u_scaleRatio;
uniform float u_lowerThreshold;
uniform float u_higherThreshold;
void main() {
  vec4 color = texture(u_texture, v_texCoord);
  float l = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  if (l < u_lowerThreshold || l > u_higherThreshold) {
    outMask = vec4(1.0, 0.0, 0.0, 1.0);
    if (u_fillMethod == 2) {
      outColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else if (u_fillMethod == 1) {
      outColor = vec4(1.0);
    } else {
      outColor = vec4(0.0);
    }
  } else {
    outColor = vec4(
      clamp((color.r - u_lowerThreshold) * u_scaleRatio, 0.0, 1.0),
      clamp((color.g - u_lowerThreshold) * u_scaleRatio, 0.0, 1.0),
      clamp((color.b - u_lowerThreshold) * u_scaleRatio, 0.0, 1.0),
      color.a
    );
    outMask = vec4(0.0);
  }
}`;
const PD_GLSL_FILL = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_texelSize;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outMask;
void main() {
  vec4 current = texture(u_image, v_texCoord);
  vec4 mask = texture(u_mask, v_texCoord);
  if (mask.r < 0.5) {
    outColor = current;
    outMask = vec4(0.0);
    return;
  }
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  vec2 offsets[24] = vec2[](
    vec2(-1.0, 0.0), vec2(1.0, 0.0),
    vec2(0.0, -1.0), vec2(0.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0),
    vec2(-2.0, 0.0), vec2(2.0, 0.0),
    vec2(0.0, -2.0), vec2(0.0, 2.0),
    vec2(-2.0, -2.0), vec2(2.0, 2.0),
    vec2(-2.0, 2.0), vec2(2.0, -2.0),
    vec2(-1.0, -2.0), vec2(1.0, 2.0),
    vec2(-2.0, -1.0), vec2(2.0, 1.0),
    vec2(-1.0, 2.0), vec2(1.0, -2.0),
    vec2(-2.0, 1.0), vec2(2.0, -1.0)
  );
  float weights[24] = float[](
    0.6065, 0.6065, 0.6065, 0.6065,
    0.3679, 0.3679, 0.3679, 0.3679,
    0.1353, 0.1353, 0.1353, 0.1353,
    0.0183, 0.0183, 0.0183, 0.0183,
    0.0821, 0.0821, 0.0821, 0.0821,
    0.0821, 0.0821, 0.0821, 0.0821
  );
  for (int i = 0; i < 24; i++) {
    vec2 uv = v_texCoord + offsets[i] * u_texelSize;
    vec4 neighbor = texture(u_image, uv);
    vec4 neighborMask = texture(u_mask, uv);
    if (neighborMask.r < 0.5) {
      sum += neighbor * weights[i];
      weightSum += weights[i];
    }
  }
  if (weightSum > 0.0) {
    outColor = sum / weightSum;
    outMask = vec4(0.0);
  } else {
    outColor = current;
    outMask = mask;
  }
}`;
const pdGl = { gl: null, canvas: null, scaleProgram: null, fillProgram: null, vao: null,
    texA: null, texB: null, maskA: null, maskB: null, fb: null, cacheW: 0, cacheH: 0, fallback: false };

function pdGlCreateShader(type, src) {
    const gl = pdGl.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    }
    return sh;
}

function pdGlCreateProgram(vsSrc, fsSrc) {
    const gl = pdGl.gl;
    const vs = pdGlCreateShader(gl.VERTEX_SHADER, vsSrc);
    const fs = pdGlCreateShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.detachShader(prog, vs); gl.detachShader(prog, fs);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
    }
    return prog;
}

function pdGlInit(w, h) {
    if (pdGl.gl && pdGl.cacheW === w && pdGl.cacheH === h) return true;   // 已就绪且尺寸一致
    if (pdGl.fallback) return false;
    try {
        if (!pdGl.gl) {
            pdGl.canvas = document.createElement("canvas");
            const gl = pdGl.canvas.getContext("webgl2", { antialias: false });
            if (!gl) throw new Error("WebGL2 not available");
            pdGl.gl = gl;
            // VAO（全屏四边形 2 三角）
            pdGl.vao = gl.createVertexArray();
            gl.bindVertexArray(pdGl.vao);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1
            ]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
            pdGl.scaleProgram = pdGlCreateProgram(PD_GLSL_VS, PD_GLSL_SCALE);
            pdGl.fillProgram = pdGlCreateProgram(PD_GLSL_VS, PD_GLSL_FILL);
            pdGl.fb = gl.createFramebuffer();
        }
        // 尺寸变化时重建纹理
        if (pdGl.cacheW !== w || pdGl.cacheH !== h) {
            const gl = pdGl.gl;
            for (const t of [pdGl.texA, pdGl.texB, pdGl.maskA, pdGl.maskB]) if (t) gl.deleteTexture(t);
            const mkTex = (internalFormat) => {
                const t = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, t);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                return t;
            };
            pdGl.texA = mkTex(gl.RGBA8);
            pdGl.texB = mkTex(gl.RGBA8);
            // mask 用 RGBA8 而非 R8：部分驱动下 R8 挂 COLOR_ATTACHMENT 会 FRAMEBUFFER_INCOMPLETE_ATTACHMENT
            pdGl.maskA = mkTex(gl.RGBA8);
            pdGl.maskB = mkTex(gl.RGBA8);
            pdGl.cacheW = w; pdGl.cacheH = h;
        }
        return true;
    } catch (err) {
        pdGl.fallback = true;
        return false;
    }
}

function pdGlDraw(program, uniforms) {
    const gl = pdGl.gl;
    gl.useProgram(program);
    gl.bindVertexArray(pdGl.vao);
    for (const [name, u] of Object.entries(uniforms)) {
        const loc = gl.getUniformLocation(program, name);
        if (loc === null) continue;
        if (u.t === "i") gl.uniform1i(loc, u.v);
        else if (u.t === "f") gl.uniform1f(loc, u.v);
        else if (u.t === "v2") gl.uniform2fv(loc, u.v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// GPU 解码主入口：成功返回 ImageData，失败/不支持返回 null（调用方回退 CPU）
function pdGlDecode(srcData, w, h, low, high, contrast, method, iterations) {
    if (!pdGlInit(w, h)) return null;
    const gl = pdGl.gl;
    // 上传源纹理（带内容缓存：导入后源不变，只有 mask 参数变——src 纹理可复用）
    const srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, srcData);
    gl.viewport(0, 0, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pdGl.fb);
    // pass 1: scale（窗口拉伸+填充标记）
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pdGl.texA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, pdGl.maskA, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    const fillMethod = method === "white" ? 1 : method === "transparent" ? 2 : 0;
    pdGlDraw(pdGl.scaleProgram, {
        u_texture: { v: 0, t: "i" },
        u_scaleRatio: { v: high === low ? 0 : 255 / (high - low), t: "f" },
        u_lowerThreshold: { v: low / 255, t: "f" },
        u_higherThreshold: { v: high / 255, t: "f" },
        u_fillMethod: { v: fillMethod, t: "i" }
    });
    // pass 2..N: fill 迭代扩散（ping-pong）
    if (method === "ltavg" && iterations > 0) {
        let srcColor = pdGl.texA, dstColor = pdGl.texB, srcMask = pdGl.maskA, dstMask = pdGl.maskB;
        const texel = [1 / w, 1 / h];
        for (let iter = 0; iter < iterations; iter++) {
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstColor, 0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dstMask, 0);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, srcColor);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, srcMask);
            pdGlDraw(pdGl.fillProgram, {
                u_image: { v: 0, t: "i" },
                u_mask: { v: 1, t: "i" },
                u_texelSize: { v: texel, t: "v2" }
            });
            let tc = srcColor; srcColor = dstColor; dstColor = tc;
            let tm = srcMask; srcMask = dstMask; dstMask = tm;
        }
    }
    // 回读
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const out = new ImageData(w, h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out.data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(srcTex);
    return out;
}
// ---- 核心解码（单遍：窗口内真彩拉伸，窗口外标记待填充）----
function pdDecodePass(srcData, out, w, h, low, high, contrast, isFill) {
    const ratio = 255 / (high - low);
    const scaleV = (v) => Math.max(Math.min(Math.round((v - low) * ratio), 255), 0);
    const contrastScale = contrast / 50;
    for (let i = 0, p = 0; i < srcData.length; i += 4, p++) {
        const r = srcData[i], g = srcData[i + 1], b = srcData[i + 2], a = srcData[i + 3];
        const l = r * 0.299 + g * 0.587 + b * 0.114;
        if (l >= low && l <= high) {
            let rr = scaleV(r), gg = scaleV(g), bb = scaleV(b);
            if (contrast !== 0) {
                rr = Math.max(0, Math.min(255, Math.round((rr - 128) * contrastScale + 128)));
                gg = Math.max(0, Math.min(255, Math.round((gg - 128) * contrastScale + 128)));
                bb = Math.max(0, Math.min(255, Math.round((bb - 128) * contrastScale + 128)));
            }
            out.data[i] = rr; out.data[i + 1] = gg; out.data[i + 2] = bb; out.data[i + 3] = a;
        } else {
            isFill[p] = 1;
            if (pdMethod === "black") { out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
            else if (pdMethod === "white") { out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255; }
            else if (pdMethod === "transparent") { out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 0; }
            else { out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
        }
    }
}

// ---- 迭代扩散（ltavg：24 邻高斯加权均值向外扩散）----
function pdDiffuse(out, isFill, w, h, iterations) {
    // 队列版扩散：每轮只处理"待填充像素"列表（逐轮收缩），不做全图遍历。
    // 算法语义与原版 WebGL 多轮 pass 一致：24 邻高斯加权、只取已还原邻居。
    const weights = [0.6065, 0.6065, 0.6065, 0.6065, 0.3679, 0.3679, 0.3679, 0.3679,
        0.1353, 0.1353, 0.1353, 0.1353, 0.0183, 0.0183, 0.0183, 0.0183,
        0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821, 0.0821];
    const offsets = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, 1, 1, -1, 1, 1, -1,
        -2, 0, 2, 0, 0, -2, 0, 2, -2, -2, 2, 2, -2, 2, 2, -2,
        -1, -2, 1, 2, -2, -1, 2, 1, -1, 2, 1, -2, -2, 1, 2, -1];
    let fillList = [];
    for (let p = 0; p < isFill.length; p++) if (isFill[p]) fillList.push(p);
    if (fillList.length === 0) return;
    for (let iter = 0; iter < iterations && fillList.length > 0; iter++) {
        const stillOpen = [];
        for (let q = 0; q < fillList.length; q++) {
            const p = fillList[q];
            const x = p % w, y = (p / w) | 0;
            let sumR = 0, sumG = 0, sumB = 0, sumA = 0, wSum = 0, cnt = 0;
            for (let k = 0; k < 24; k++) {
                const nx = x + offsets[k * 2], ny = y + offsets[k * 2 + 1];
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                const np = ny * w + nx;
                if (isFill[np]) continue;
                const w8 = weights[k];
                sumR += out.data[np * 4] * w8; sumG += out.data[np * 4 + 1] * w8;
                sumB += out.data[np * 4 + 2] * w8; sumA += out.data[np * 4 + 3] * w8;
                wSum += w8; cnt++;
            }
            if (cnt > 0) {
                out.data[p * 4] = sumR / wSum; out.data[p * 4 + 1] = sumG / wSum;
                out.data[p * 4 + 2] = sumB / wSum; out.data[p * 4 + 3] = sumA / wSum;
                isFill[p] = 0;
            } else {
                stillOpen.push(p);
            }
        }
        fillList = stillOpen;
    }
}

// ---- 实时渲染（rAF 合帧）----
function renderPd() {
    if (!pdCanvas) return;
    const w = pdCanvas.width, h = pdCanvas.height;
    if (!pdSrcCache) {
        pdSrcCache = pdCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h);
    }
    const srcData = pdSrcCache;
    const low = parseInt(pdLow.value, 10), high = parseInt(pdHigh.value, 10);
    const contrast = parseInt(pdContrast.value, 10);
    const iterations = parseInt(pdIterSlider.value, 10);
    // 全部渲染走 GPU（与原版一致：参数任何变化都直接完整渲染，GPU 毫秒级 + rAF 合帧 = 拖动实时）。
    // GPU 不可用才回退 CPU 队列版（pdGl.fallback）。
    if (!pdGl.fallback) {
        const gpuOut = pdGlDecode(srcData.data, w, h, low, high, contrast, pdMethod, iterations);
        if (gpuOut) {
            const cvG = document.getElementById("canvas-pd-out");
            cvG.width = w; cvG.height = h;
            cvG.getContext("2d").putImageData(gpuOut, 0, 0);
            cvG.hidden = false;
            document.getElementById("card-pd-result").style.display = "block";
            document.getElementById("txt-pd-summary").textContent =
                `窗口 [${low}, ${high}] | 对比度 ${contrast} | 迭代 ${pdMethod === "ltavg" ? iterations : "—"} | ${w}x${h}`;
            pdRendered = true;
            return;
        }
    }
    // CPU 回退（WebGL2 不可用）
    const out = new ImageData(w, h);
    const isFill = new Uint8Array(w * h);
    pdDecodePass(srcData.data, out, w, h, low, high, contrast, isFill);
    if (pdMethod === "ltavg") pdDiffuse(out, isFill, w, h, iterations);
    const cv = document.getElementById("canvas-pd-out");
    cv.width = w; cv.height = h;
    cv.getContext("2d").putImageData(out, 0, 0);
    cv.hidden = false;
    document.getElementById("card-pd-result").style.display = "block";
    document.getElementById("txt-pd-summary").textContent =
        `窗口 [${low}, ${high}] | 对比度 ${contrast} | 迭代 ${pdMethod === "ltavg" ? iterations : "—"} | ${w}x${h}`;
    pdRendered = true;
}

let pdRafGuard = 0;
function schedulePdRender() {
    if (pdRaf) return;
    pdRaf = requestAnimationFrame(() => { pdRaf = 0; renderPd(); });
}



document.getElementById("btn-pd-download").addEventListener("click", () => {
    const cv = document.getElementById("canvas-pd-out");
    if (cv.hidden) { alert("请先解码"); return; }
    cv.toBlob(blob => {
        const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `prism_decode_${stamp}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, "image/png");
});

// ---- 元数据预设串读取（与 Mirage_Decode 同格式：isReversed(1) + thresholdHex(2) + contrastHex(2)）----
// PNG：tEXt chunk 整体数据即预设串；JPEG：EXIF UserComment/ImageDescription
function pdDecodePresetBytes(bytes) {
    const latin1 = (arr) => { let s = ""; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]); return s; };
    // PNG tEXt
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
        let pos = 8;
        while (pos + 8 <= bytes.length) {
            const size = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
            const type = latin1(bytes.slice(pos + 4, pos + 8));
            if (type === "tEXt") {
                return latin1(bytes.slice(pos + 8, pos + 8 + size));
            }
            if (size < 0 || pos + size + 12 > bytes.length) break;
            pos += size + 12;
        }
        return "";
    }
    // JPEG EXIF（UserComment / ImageDescription 中的 5 字符预设串）
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        let pos = 2;
        while (pos + 4 <= bytes.length) {
            if (bytes[pos] !== 0xFF) { pos++; continue; }
            const marker = bytes[pos + 1];
            if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { pos += 2; continue; }
            if (marker === 0xDA) break;
            const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
            if (marker === 0xE1) {
                const seg = bytes.slice(pos + 4, pos + 2 + len);
                // 找 UserComment（标签 0x8649）里的 ASCII 内容
                for (let i = 0; i < seg.length - 12; i++) {
                    // UserComment: "ASCII\0\0\0" + 内容
                    if (seg[i] === 0x41 && seg[i + 1] === 0x53 && seg[i + 2] === 0x43 && seg[i + 3] === 0x49 && seg[i + 4] === 0x49) {
                        const text = latin1(seg.slice(i + 8, Math.min(seg.length, i + 8 + 64))).replace(/[^\x20-\x7e]/g, " ").trim();
                        if (text.length >= 5) return text;
                    }
                }
                // ImageDescription（标签 0x010E）里的预设串
                for (let i = 0; i < seg.length - 12; i++) {
                    if (seg[i] === 0x01 && seg[i + 1] === 0x0E) {
                        // 找偏移与长度——简化：从 IFD0 之后搜 5 字符候选（格式 [01]xx 两位hex）
                        const after = latin1(seg.slice(i, i + 200));
                        const m = after.match(/[01][0-9a-fA-F]{2}[0-9a-fA-F]{2}/);
                        if (m) return m[0];
                    }
                }
            }
            pos += 2 + len;
        }
        return "";
    }
    return "";
}

// 预设串 → 阈值/对比度（与原版 decodePreset 同逻辑）
function pdApplyPreset(str) {
    if (!str || str.length < 3) return false;
    const isReversed = str[0] === "1";
    const threshold = parseInt(str.slice(1, 3), 16);
    if (isNaN(threshold)) return false;
    if (isReversed) {
        pdLow.value = String(255 - threshold);
        pdHigh.value = "255";
    } else {
        pdLow.value = "0";
        pdHigh.value = String(threshold);
    }
    if (str.length >= 5) {
        const contrast = parseInt(str.slice(3, 5), 16);
        if (!isNaN(contrast) && contrast >= 0 && contrast <= 100) {
            pdContrast.value = String(Math.round((100 - contrast) * 255 / 50 - 255) === 0 ? 0 : (100 - contrast));
        }
    }
    pdSyncSliders("preset");
    return true;
}

inputPd.addEventListener("change", async (e) => {
    const f = e.target.files ? e.target.files[0] : null;
    e.target.value = "";
    if (!f) return;
    try {
        // 先读原始字节（元数据预设串优先，与原版 decodePreset 一致）
        const bytes = new Uint8Array(await f.arrayBuffer());
        const presetStr = pdDecodePresetBytes(bytes);
        const img = await loadImage(URL.createObjectURL(f));
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
        cv.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, cv.width, cv.height);
        pdCanvas = cv;
        pdSrcCache = null;   // 新图导入，清缓存
        const pv = document.getElementById("img-pd-preview");
        pv.src = cv.toDataURL("image/jpeg", 0.9); pv.style.display = "block";
        boxPd.querySelector(".upload-icon").style.display = "none";
        boxPd.querySelector(".upload-text").style.display = "none";
        boxPd.querySelector(".upload-hint").style.display = "none";
        const badge = document.getElementById("badge-pd-info");
        badge.style.display = "block";
        badge.textContent = `已选: ${f.name} (${cv.width}x${cv.height})`;
        // 参数来源优先级：① 图内元数据预设串（与原版一致）② 灰度直方图内容区推断
        if (presetStr && pdApplyPreset(presetStr)) {
            badge.textContent += " ｜ 已读取图内解码参数";
        } else {
            const srcData = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
            const auto = autoDetectThresholds(srcData.data);
            pdLow.value = String(auto.lower); pdHigh.value = String(auto.higher);
            pdSyncSliders("auto");
        }
    } catch (err) { alert("加载失败: " + err.message); }
});

// ===== 8.10 高级编码（Prism Advanced Encode，多图阈值分区） =====
    let advInputs = [];
    let advWidth = 1000, advHeight = 1000;
    const advList = document.getElementById("adv-input-list");
    document.getElementById("adv-num-width").addEventListener("input", (e) => {
        advWidth = Math.max(10, Math.min(10000, parseInt(e.target.value, 10) || 1000));
    });
    const advHeightInput = document.getElementById("adv-num-height");
    advHeightInput.addEventListener("input", (e) => {
        advHeight = Math.max(10, Math.min(10000, parseInt(e.target.value, 10) || 1000));
    });
    const advLockRatio = document.getElementById("chk-adv-lock-ratio");
    advLockRatio.addEventListener("change", () => {
        // 锁定比例时高度由第一张图决定，输入框禁用；取消勾选才可手动填
        advHeightInput.disabled = advLockRatio.checked;
        advHeightInput.style.opacity = advLockRatio.checked ? "0.5" : "";
    });
    advHeightInput.disabled = true;   // 默认锁定比例，高度框初始禁用
    advHeightInput.style.opacity = "0.5";

    function renderAdvInputs() {
        advList.innerHTML = "";
        advInputs.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = "merge-file-item";
            row.style.flexWrap = "wrap";
            // 缩略图预览
            const thumb = document.createElement("img");
            thumb.src = item.img.src || item.img.toDataURL("image/jpeg", 0.8);
            thumb.style.width = "44px";
            thumb.style.height = "44px";
            thumb.style.objectFit = "cover";
            thumb.style.borderRadius = "6px";
            thumb.style.border = "1px solid var(--border)";
            row.appendChild(thumb);
            const name = document.createElement("span");
            name.className = "merge-file-name";
            name.style.flex = "1";
            name.textContent = `${i + 1}. ${item.name}`;
            row.appendChild(name);
            const mkLbl = (t) => { const sp = document.createElement("span"); sp.textContent = t; sp.style.color = "var(--text-faint)"; return sp; };
            const mkNum = (min, max, val, cb) => {
                const inN = document.createElement("input");
                inN.type = "number"; inN.min = String(min); inN.max = String(max); inN.value = String(val);
                inN.style.width = "54px";
                inN.addEventListener("input", () => cb(parseInt(inN.value, 10) || min));
                return inN;
            };
            row.appendChild(mkLbl("下限"));
            row.appendChild(mkNum(0, 254, item.lower, (v) => { advInputs[i].lower = v; }));
            row.appendChild(mkLbl("上限"));
            row.appendChild(mkNum(1, 255, item.higher, (v) => { advInputs[i].higher = v; }));
            row.appendChild(mkLbl("权重"));
            row.appendChild(mkNum(1, 20, item.weight, (v) => { advInputs[i].weight = v; }));
            const del = document.createElement("button");
            del.className = "merge-file-del";
            del.textContent = "✕";
            del.title = "移除";
            del.addEventListener("click", () => { advInputs.splice(i, 1); renderAdvInputs(); });
            row.appendChild(del);
            advList.appendChild(row);
        });
    }

    document.getElementById("btn-adv-add").addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
        inp.addEventListener("change", async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            for (const file of files) {
                try {
                    const img = await loadImage(URL.createObjectURL(file));
                    const last = advInputs[advInputs.length - 1];
                    const lower = last ? Math.min(254, last.higher + 5) : 0;
                    const higher = Math.min(255, lower + 24);
                    advInputs.push({ file, name: file.name, img, lower, higher, weight: 1 });
                } catch (err) { /* 跳过 */ }
            }
            renderAdvInputs();
        });
        inp.click();
    });

    document.getElementById("btn-adv-run").addEventListener("click", async () => {
        if (advInputs.length === 0) { alert("请先添加图片"); return; }
        const btn = document.getElementById("btn-adv-run");
        btn.disabled = true;
        btn.textContent = "⏳ 编码中...";
        try {
            const w = advWidth;
            const h = document.getElementById("chk-adv-lock-ratio").checked
                ? Math.max(10, Math.round(advWidth * (advInputs[0].img.naturalHeight / advInputs[0].img.naturalWidth)))
                : advHeight;
            const inputs = [];
            for (const item of advInputs) {
                const fit = clFitCover(item.img, w, h);
                const ctx = fit.getContext("2d", { willReadFrequently: true });
                inputs.push({
                    imageData: ctx.getImageData(0, 0, w, h),
                    lowerThreshold: item.lower,
                    higherThreshold: item.higher,
                    weight: item.weight
                });
            }
            const out = new ImageData(w, h);
            const weightSum = inputs.reduce((s, x) => s + x.weight, 0);
            for (let i = 0, x = 0, y = 0; i < inputs[0].imageData.data.length; i += 4) {
                const offset = (x + y) % weightSum;
                let sel = inputs[inputs.length - 1];
                for (let n = 0, acc = 0; n < inputs.length && acc < weightSum; n++) {
                    if (acc + inputs[n].weight > offset) { sel = inputs[n]; break; }
                    acc += inputs[n].weight;
                }
                const lo = sel.lowerThreshold, hi = sel.higherThreshold;
                const scale = (v) => lo >= hi ? lo : Math.floor(Math.max(lo, Math.min((v * (hi - lo)) / 255 + lo, hi)));
                out.data[i] = scale(sel.imageData.data[i]);
                out.data[i + 1] = scale(sel.imageData.data[i + 1]);
                out.data[i + 2] = scale(sel.imageData.data[i + 2]);
                out.data[i + 3] = sel.imageData.data[i + 3];
                x++;
                if (x >= w) { x = 0; y++; }
            }
            const cv = document.getElementById("canvas-adv-out");
            cv.width = w; cv.height = h;
            cv.getContext("2d").putImageData(out, 0, 0);
            cv.hidden = false;
            document.getElementById("card-adv-result").style.display = "block";
            document.getElementById("txt-adv-summary").textContent = `${inputs.length} 张图 | 输出 ${w}x${h}`;
        } catch (e) {
            alert("编码失败: " + e.message);
        }
        btn.disabled = false;
        btn.textContent = "🌈 生成多图幻影";
    });

    document.getElementById("btn-adv-download").addEventListener("click", () => {
        const cv = document.getElementById("canvas-adv-out");
        if (cv.hidden) { alert("请先生成"); return; }
        cv.toBlob(blob => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `prism_multi_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, "image/png");
    });    const modal = document.getElementById("modal-preview");
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
                alert("没有检测到文件，请把本地文件拖到这里");
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
    // 1.0.1 直达路径：启动时按 URL 路径进入对应功能（/split /chaos /clean /weathering /processing /md5）
    // 站点无 404.html，Cloudflare Pages 按 SPA 兜底把所有未知路径 200 返回 index.html，
    // 无需 _redirects（写了反而会因 /index.html 规范化 308 跳回 /）；本地 file:// 不受影响
    // 【必须放在文件末尾】switchPage 对图片处理/图片工具页会调用 applySubTabsForPage，
    // 它引用的 mergeSubPanels / SUB_TABS_BY_PAGE 是本闭包后段的顶层 const——放在前面会因 TDZ
    // 未初始化抛错，导致刷新进入这两页时顶栏状态错乱（主 Tab 误显示、子标签全显）。
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
});
