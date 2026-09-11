// Web 端主应用逻辑
document.addEventListener("DOMContentLoaded", () => {
    // 状态
    let srcFiles = [];
    let customCoverBlob = null;
    let selectedBgColor = "#000000";
    let lastDisguisedResults = []; // { blob, filename, url }
    let lastRestoredResults = []; // { blob, filename, url, format }
    let restoreFiles = [];

    // DOM
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabPages = document.querySelectorAll(".tab-page");

    // 1. Tab 切换
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabPages.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            const targetId = btn.getAttribute("data-tab");
            document.getElementById(targetId).classList.add("active");

            if (targetId === "page-history") {
                renderHistory();
            }
        });
    });

    // 2. 底色配置加载与选择 (localStorage 持久化)
    const savedBgColor = localStorage.getItem("png_web_bg_color") || "black";
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
        let target = document.querySelector(`.color-item[data-key="${key}"]`) || document.querySelector(`.color-item[data-key="black"]`);
        target.classList.add("selected");
        selectedBgColor = target.getAttribute("data-color");
        document.getElementById("txt-selected-color-name").textContent = "当前: " + target.getAttribute("data-name");
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
            alert("当前为官方默认封面，无需重复保存");
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
        document.getElementById("txt-cover-status").textContent = "内置官方经典蓝色封面 (默认)";
        alert("已恢复并保存为官方默认封面");
    });

    // 4. 选择要伪装的原图
    const boxSrc = document.getElementById("box-src-upload");
    const inputSrc = document.getElementById("input-src-images");
    boxSrc.addEventListener("click", () => inputSrc.click());

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
        // 读取原图并取得 Canvas 像素
        const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
        const srcImg = await loadImage(URL.createObjectURL(file));
        const w = srcImg.width;
        const h = srcImg.height;

        // 生成等尺寸底色封面图 Canvas
        const coverCanvas = document.createElement("canvas");
        coverCanvas.width = w;
        coverCanvas.height = h;
        const cctx = coverCanvas.getContext("2d");

        // 填底色
        cctx.fillStyle = bgColor;
        cctx.fillRect(0, 0, w, h);

        // 居中放置封面
        const scale = Math.min(w / coverImg.width, h / coverImg.height);
        const dw = Math.max(1, Math.round(coverImg.width * scale));
        const dh = Math.max(1, Math.round(coverImg.height * scale));
        const dx = Math.round((w - dw) / 2);
        const dy = Math.round((h - dh) / 2);
        cctx.drawImage(coverImg, dx, dy, dw, dh);

        // 绘制徽章
        if (badgeNum) {
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

        // 导出封面 PNG IDAT 与原图 PNG IDAT
        const coverPngBlob = await canvasToPngBlob(coverCanvas);
        const coverBuf = new Uint8Array(await coverPngBlob.arrayBuffer());
        const coverChunks = ApngCodec.parseChunks(coverBuf);
        const coverIdats = coverChunks.filter(c => c.type === "IDAT").map(c => c.payload);

        const srcPngBlob = await canvasToPngBlob(srcImg);
        const srcBuf = new Uint8Array(await srcPngBlob.arrayBuffer());
        const srcChunks = ApngCodec.parseChunks(srcBuf);
        const srcIdats = srcChunks.filter(c => c.type === "IDAT").map(c => c.payload);

        // 组装 APNG
        let parts = [
            ApngCodec.PNG_SIG,
            ApngCodec.chunkBytes("IHDR", coverChunks.find(c => c.type === "IHDR").payload)
        ];

        // acTL (2 frames, playCount 0)
        let actl = new Uint8Array(8);
        new DataView(actl.buffer).setUint32(0, 2, false);
        new DataView(actl.buffer).setUint32(4, 0, false);
        parts.push(ApngCodec.chunkBytes("acTL", actl));

        // tEXt marker
        let markerStr = `ChatBarApngDisguise\01;STATIC;1`;
        parts.push(ApngCodec.chunkBytes("tEXt", new TextEncoder().encode(markerStr)));

        // Default frame IDATs
        for (let p of coverIdats) {
            parts.push(ApngCodec.chunkBytes("IDAT", p));
        }

        let seq = 0;
        // Frame 1 fcTL
        let fctl1 = new Uint8Array(26);
        let vf1 = new DataView(fctl1.buffer);
        vf1.setUint32(0, seq++, false);
        vf1.setUint32(4, w, false);
        vf1.setUint32(8, h, false);
        vf1.setUint32(12, 0, false);
        vf1.setUint32(16, 0, false);
        vf1.setUint16(20, 10, false);
        vf1.setUint16(22, 100, false);
        vf1.setUint8(24, 0); // dispose
        vf1.setUint8(25, 0); // blend
        parts.push(ApngCodec.chunkBytes("fcTL", fctl1));

        // Frame 1 fdATs
        for (let p of srcIdats) {
            let fdat = new Uint8Array(4 + p.length);
            new DataView(fdat.buffer).setUint32(0, seq++, false);
            fdat.set(p, 4);
            parts.push(ApngCodec.chunkBytes("fdAT", fdat));
        }

        // Frame 2: 1x1 透明心跳保活帧 (blend_op = 1)
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

        // 1x1 透明像素
        let hbCanvas = document.createElement("canvas");
        hbCanvas.width = 1; hbCanvas.height = 1;
        let hbBlob = await canvasToPngBlob(hbCanvas);
        let hbBuf = new Uint8Array(await hbBlob.arrayBuffer());
        let hbIdat = ApngCodec.parseChunks(hbBuf).find(c => c.type === "IDAT").payload;
        let hbFdat = new Uint8Array(4 + hbIdat.length);
        new DataView(hbFdat.buffer).setUint32(0, seq++, false);
        hbFdat.set(hbIdat, 4);
        parts.push(ApngCodec.chunkBytes("fdAT", hbFdat));

        parts.push(ApngCodec.chunkBytes("IEND", new Uint8Array(0)));

        return new Blob([ApngCodec.concatBuffers(parts)], { type: "image/png" });
    }

    // 6. 还原功能
    const boxRestore = document.getElementById("box-restore-upload");
    const inputRestore = document.getElementById("input-restore-images");
    boxRestore.addEventListener("click", () => inputRestore.click());

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
                const isAnim = info.meta.kind === "ANIMATED" || info.meta.count >= 5;
                const kindStr = info.meta.kind === "ANIMATED" ? "动图隐写" : (info.meta.kind === "STATIC" ? "静态隐写" : "标准隐藏帧");
                badge.textContent = `✔ 识别为伪装 APNG (${kindStr}, 隐藏${info.meta.count}帧, 尺寸 ${info.width}x${info.height}, 将还原为 ${isAnim ? "GIF 动图" : "PNG 图片"})`;
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
                const isAnim = info.meta.kind === "ANIMATED" || groups.length >= 5;

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
                        const canvas = document.createElement("canvas");
                        canvas.width = frameImg.width;
                        canvas.height = frameImg.height;
                        const ctx = canvas.getContext("2d");
                        ctx.drawImage(frameImg, 0, 0);
                        const imgData = ctx.getImageData(0, 0, frameImg.width, frameImg.height);
                        gifEncoder.addFrame(imgData, 100);
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
                lastRestoredResults.push({ blob: restoredBlob, filename, url, format });

                saveToHistory("restored", filename, restoredBlob, url);
            }

            if (lastRestoredResults.length === 0) {
                alert("未能从所选文件中解析出有效隐藏图片");
                return;
            }

            const firstRes = lastRestoredResults[0];
            document.getElementById("card-restore-result").style.display = "block";
            document.getElementById("img-restored-preview").src = firstRes.url;

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

    // 7. 下载与分享按钮
    document.getElementById("btn-download-disguise").addEventListener("click", () => downloadAll(lastDisguisedResults));
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
        modalImg.src = url;
        modal.style.display = "flex";
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

    function canvasToPngBlob(canvas) {
        return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    }
});
