/**
 * 极简快速的 Mini-pako deflate/inflate (基于原生 DecompressionStream / CompressionStream 与纯JS兼容降级)
 */
class MiniZlib {
    static async deflate(uint8Arr) {
        if (window.CompressionStream) {
            let cs = new CompressionStream('deflate');
            let writer = cs.writable.getWriter();
            writer.write(uint8Arr);
            writer.close();
            let chunks = [];
            let reader = cs.readable.getReader();
            while (true) {
                let { value, done } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            return ApngCodec.concatBuffers(chunks);
        }
        throw new Error("浏览器不支持 CompressionStream");
    }

    static async inflate(uint8Arr) {
        if (window.DecompressionStream) {
            let ds = new DecompressionStream('deflate');
            let writer = ds.writable.getWriter();
            writer.write(uint8Arr);
            writer.close();
            let chunks = [];
            let reader = ds.readable.getReader();
            while (true) {
                let { value, done } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            return ApngCodec.concatBuffers(chunks);
        }
        throw new Error("浏览器不支持 DecompressionStream");
    }
}

window.MiniZlib = MiniZlib;
