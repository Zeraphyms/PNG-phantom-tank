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
    function switchPage(targetId) {
        tabPages.forEach(p => p.classList.remove("active"));
        const page = document.getElementById(targetId);
        if (page) page.classList.add("active");

        // 非主 Tab 页（拆解动图 / 图片混沌）由「更多功能」菜单承载
        tabBtns.forEach(b => {
            b.classList.toggle("active", b.getAttribute("data-tab") === targetId);
        });
        document.querySelectorAll(".menu-item").forEach(mi => {
            mi.classList.toggle("active", mi.getAttribute("data-tab") === targetId);
        });

        if (targetId === "page-history") {
            renderHistory();
        }
    }

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => switchPage(btn.getAttribute("data-tab")));
    });

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
