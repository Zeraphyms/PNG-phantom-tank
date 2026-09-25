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

    // 3. 封面持久化加载
    const savedCoverDataUrl = localStorage.getItem("png_web_custom_cover");
    if (savedCoverDataUrl) {
        document.getElementById("img-cover-thumb").src = savedCoverDataUrl;
        document.getElementById("txt-cover-status").textContent = "自定义封面 [已持久保存]";
        fetch(savedCoverDataUrl).then(r => r.blob()).then(b => customCoverBlob = b);
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
        document.getElementById("img-cover-thumb").src = "assets/default_cover.png";
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
                const disguisedApngBlob = await disguiseSingleFile(file, coverImg, badgeNum, selectedBgColor);
                const filename = `${String(i + 1).padStart(3, "0")}_disguised_${timeBase}.png`;
                const url = URL.createObjectURL(disguisedApngBlob);
                lastDisguisedResults.push({ blob: disguisedApngBlob, filename, url });

                // 保存到 IndexedDB 历史
                saveToHistory("disguised", filename, disguisedApngBlob, url);
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
    async function disguiseSingleFile(file, coverImg, badgeNum, bgColor) {
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
            return new Blob([ApngCodec.concatBuffers(parts)], { type: "image/png" });
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
        return new Blob([ApngCodec.concatBuffers(parts)], { type: "image/png" });
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

                saveToHistory("restored", filename, restoredBlob, url);
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
            lastSplitResults.forEach((item, idx) => {
                const el = document.createElement("div");
                el.className = "split-frame-item";
                el.innerHTML = `<img src="${item.url}" alt="frame"><div class="split-frame-label">${item.filename}</div>`;
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

    boxChaos.addEventListener("click", () => inputChaos.click());
    enableDropUpload(boxChaos, inputChaos);

    inputChaos.addEventListener("change", async (e) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        const preview = document.getElementById("img-chaos-preview");

        try {
            const img = await loadImage(URL.createObjectURL(file));
            chaosSourceCanvas = ImageChaos.toCanvas(img);

            const srcUrl = chaosSourceCanvas.toDataURL("image/jpeg", 0.95);
            preview.src = srcUrl;
            preview.style.display = "block";
            boxChaos.querySelector(".upload-icon").style.display = "none";
            boxChaos.querySelector(".upload-text").style.display = "none";
            boxChaos.querySelector(".upload-hint").style.display = "none";

            const srcImgEl = document.getElementById("img-chaos-src");
            srcImgEl.src = srcUrl;
            srcImgEl.hidden = false;
            document.getElementById("chaos-empty-src").hidden = true;
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

    refreshChaosActionState();

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

    async function saveToHistory(type, filename, blob, url) {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).add({
                type,
                filename,
                blob,
                size: blob.size,
                time: new Date().toLocaleString("zh-CN")
            });
        } catch (e) {}
    }

    async function renderHistory() {
        const container = document.getElementById("list-history-container");
        container.innerHTML = "";
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
                    return;
                }

                list.forEach(item => {
                    const el = document.createElement("div");
                    el.className = "history-item";
                    const itemUrl = URL.createObjectURL(item.blob);
                    el.innerHTML = `
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
            };
        } catch (e) {
            container.innerHTML = `<div class="card" style="color: #EF4444;">读取本地历史失败</div>`;
        }
    }

    document.getElementById("btn-clear-history").addEventListener("click", async () => {
        if (!confirm("确定要清空所有本地历史记录与缓存吗？")) return;
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => renderHistory();
        } catch (e) {}
    });

    // 9. 大图预览 Modal
    const modal = document.getElementById("modal-preview");
    const modalImg = document.getElementById("modal-img");
    modal.addEventListener("click", () => modal.style.display = "none");

    function showModal(url) {
        if (!url) return;
        modalImg.src = url;
        modal.style.display = "flex";
    }

    // 还原结果：点击真图 / 封面缩略图查看大图
    const imgRestoredPreview = document.getElementById("img-restored-preview");
    const imgRestoreCover = document.getElementById("img-restore-cover");

    if (imgRestoredPreview) {
        imgRestoredPreview.addEventListener("click", () => {
            if (imgRestoredPreview.getAttribute("src")) {
                showModal(imgRestoredPreview.src);
            }
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
            img.crossOrigin = "anonymous";
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
