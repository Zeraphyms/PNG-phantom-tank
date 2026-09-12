/**
 * ApngCodec.js - 纯前端浏览器环境下的 APNG 编解码与幻影坦克隐写
 * 支持标准 PNG / APNG 解析，完全在本地浏览器离线运行
 */
class ApngCodec {
    static PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    static MARKER_KEYWORD = "ChatBarApngDisguise";
    static FORMAT_VERSION = 1;

    static crcTable = (() => {
        let c;
        let table = [];
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[n] = c;
        }
        return new Uint32Array(table);
    })();

    static crc32(buf, start = 0, length = buf.length) {
        let crc = -1;
        for (let i = start; i < start + length; i++) {
            crc = (crc >>> 8) ^ ApngCodec.crcTable[(crc ^ buf[i]) & 0xFF];
        }
        return (crc ^ (-1)) >>> 0;
    }

    static chunkBytes(typeStr, data) {
        let typeBytes = new TextEncoder().encode(typeStr);
        let dataLen = data ? data.length : 0;
        let chunk = new Uint8Array(4 + 4 + dataLen + 4);
        let view = new DataView(chunk.buffer);

        view.setUint32(0, dataLen, false);
        chunk.set(typeBytes, 4);
        if (dataLen > 0) {
            chunk.set(data, 8);
        }

        // 计算 Type + Data 的 CRC
        let crc = ApngCodec.crc32(chunk, 4, 4 + dataLen);
        view.setUint32(8 + dataLen, crc, false);
        return chunk;
    }

    static concatBuffers(buffers) {
        let totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
        let out = new Uint8Array(totalLen);
        let offset = 0;
        for (let b of buffers) {
            out.set(b, offset);
            offset += b.length;
        }
        return out;
    }

    static parseChunks(uint8Arr) {
        for (let i = 0; i < 8; i++) {
            if (uint8Arr[i] !== ApngCodec.PNG_SIG[i]) {
                throw new Error("不是合法的 PNG 文件格式");
            }
        }

        let pos = 8;
        let chunks = [];
        let view = new DataView(uint8Arr.buffer, uint8Arr.byteOffset, uint8Arr.byteLength);

        while (pos + 8 <= uint8Arr.length) {
            let length = view.getUint32(pos, false);
            let type = new TextDecoder().decode(uint8Arr.subarray(pos + 4, pos + 8));
            let payload = uint8Arr.slice(pos + 8, pos + 8 + length);
            chunks.push({ type, payload });
            pos += 12 + length;
            if (type === "IEND") break;
        }
        return chunks;
    }

    static inspectDisguise(uint8Arr) {
        try {
            let chunks = ApngCodec.parseChunks(uint8Arr);
            let hasAcTL = false;
            let fctlCount = 0;
            for (let c of chunks) {
                if (c.type === "acTL") hasAcTL = true;
                if (c.type === "fcTL") fctlCount++;
            }
            if (!hasAcTL || fctlCount === 0) return null;

            let meta = null;
            for (let c of chunks) {
                if (c.type === "tEXt") {
                    let nullIdx = -1;
                    for (let i = 0; i < c.payload.length; i++) {
                        if (c.payload[i] === 0) {
                            nullIdx = i;
                            break;
                        }
                    }
                    if (nullIdx !== -1) {
                        let keyword = new TextDecoder().decode(c.payload.subarray(0, nullIdx));
                        if (keyword === ApngCodec.MARKER_KEYWORD) {
                            let text = new TextDecoder().decode(c.payload.subarray(nullIdx + 1));
                            let parts = text.split(";");
                            if (parts.length === 3) {
                                meta = {
                                    version: parseInt(parts[0]),
                                    kind: parts[1], // STATIC or ANIMATED
                                    count: parseInt(parts[2])
                                };
                                break;
                            }
                        }
                    }
                }
            }

            if (!meta) {
                meta = { version: 1, kind: "GENERIC", count: fctlCount };
            }

            let width = 0, height = 0;
            for (let c of chunks) {
                if (c.type === "IHDR") {
                    let v = new DataView(c.payload.buffer, c.payload.byteOffset, c.payload.byteLength);
                    width = v.getUint32(0, false);
                    height = v.getUint32(4, false);
                    break;
                }
            }

            return { width, height, meta, chunks };
        } catch (e) {
            return null;
        }
    }

    static extractFrameGroups(chunks) {
        let groups = [];
        let cur = null;
        for (let c of chunks) {
            if (c.type === "IDAT") {
                if (cur) cur.pieces.push(c.payload);
            } else if (c.type === "fcTL") {
                cur = { fcTL: c.payload, pieces: [] };
                groups.push(cur);
            } else if (c.type === "fdAT") {
                if (cur && c.payload.length >= 4) {
                    // 去掉前 4 字节 sequence number
                    cur.pieces.push(c.payload.subarray(4));
                }
            }
        }
        // 过滤末尾 1x1 心跳保活帧，避免把它当成真实隐藏帧
        if (groups.length > 0 && ApngCodec.isHeartbeatFrame(groups[groups.length - 1])) {
            groups.pop();
        }
        return groups;
    }

    static isHeartbeatFrame(group) {
        if (!group.fcTL || group.fcTL.length < 12) return false;
        let v = new DataView(group.fcTL.buffer, group.fcTL.byteOffset, group.fcTL.byteLength);
        return v.getUint32(4, false) === 1 && v.getUint32(8, false) === 1;
    }

    static countHiddenFrames(groups) {
        return groups.filter(g => !ApngCodec.isHeartbeatFrame(g)).length;
    }

    static frameGroupToPng(ihdrPayload, group) {
        let targetIhdr = new Uint8Array(ihdrPayload);
        let vIhdr = new DataView(targetIhdr.buffer, targetIhdr.byteOffset, targetIhdr.byteLength);
        if (group.fcTL && group.fcTL.length >= 12) {
            let vFctl = new DataView(group.fcTL.buffer, group.fcTL.byteOffset, group.fcTL.byteLength);
            let rw = vFctl.getUint32(4, false);
            let rh = vFctl.getUint32(8, false);
            if (rw > 0 && rh > 0) {
                vIhdr.setUint32(0, rw, false);
                vIhdr.setUint32(4, rh, false);
            }
        }

        let parts = [
            ApngCodec.PNG_SIG,
            ApngCodec.chunkBytes("IHDR", targetIhdr)
        ];
        for (let p of group.pieces) {
            parts.push(ApngCodec.chunkBytes("IDAT", p));
        }
        parts.push(ApngCodec.chunkBytes("IEND", new Uint8Array(0)));
        return ApngCodec.concatBuffers(parts);
    }
}

window.ApngCodec = ApngCodec;
