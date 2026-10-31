package com.pngdisguise.web;

import android.app.Activity;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 图片工具（网页版离线壳）
 * 点开即整屏加载 assets/web/index.html（与网页版完全一致，纯本地离线运行）。
 * 提供 JS 桥：网页里的"下载文件"转存系统相册；文本复制走原生剪贴板。
 */
public class WebActivity extends Activity {

    private WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(false);
        try {
            // 老 WebView（API<30 左右）需要反射打开 file:// 通用访问，
            // 让页面内 fetch/Worker 读写同目录资源无阻
            java.lang.reflect.Method m = WebSettings.class.getMethod(
                    "setAllowUniversalAccessFromFileURLs", boolean.class);
            m.invoke(s, true);
            java.lang.reflect.Method m2 = WebSettings.class.getMethod(
                    "setAllowFileAccessFromFileURLs", boolean.class);
            m2.invoke(s, true);
        } catch (Exception ignored) {}

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // 站外链接（GitHub 等）交给系统浏览器
                if (url != null && url.startsWith("http")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {}
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectDownloadHook(view);
                super.onPageFinished(view, url);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new ToolsBridge(), "AndroidBridge");
        webView.loadUrl("file:///android_asset/web/index.html");
    }

    /** 注入下载劫持：网页版所有"保存"都是 <a download href=blob:...> 点击，拦截转 base64 走原生桥 */
    private void injectDownloadHook(WebView view) {
        view.evaluateJavascript(
            "(function(){" +
            "  if (window.__dlHooked) return;" +
            "  window.__dlHooked = true;" +
            "  var proto = HTMLAnchorElement.prototype;" +
            "  var origClick = proto.click;" +
            "  proto.click = function() {" +
            "    var href = this.getAttribute('href') || '';" +
            "    if (href.indexOf('blob:') === 0 && window.AndroidBridge) {" +
            "      var name = this.getAttribute('download') || ('download_' + Date.now() + '.png');" +
            "      fetch(href).then(function(r){ return r.blob(); }).then(function(b){" +
            "        var fr = new FileReader();" +
            "        fr.onload = function(){" +
            "          var b64 = String(fr.result).split(',')[1] || '';" +
            "          window.AndroidBridge.saveBase64(b64, name);" +
            "        };" +
            "        fr.readAsDataURL(b);" +
            "      });" +
            "      return;" +
            "    }" +
            "    origClick.call(this);" +
            "  };" +
            "})();", null);
    }

    /** JS 桥 */
    private class ToolsBridge {

        /** base64 数据保存到系统相册 Pictures/PNG伪装 */
        @JavascriptInterface
        public String saveBase64(final String base64, final String fileName) {
            try {
                final byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                mainHandler.post(new Runnable() {
                    public void run() {
                        try {
                            String name = (fileName == null || fileName.length() == 0)
                                    ? ("tools_" + System.currentTimeMillis() + ".png") : fileName;
                            saveBytesToPictures(data, name);
                            Toast.makeText(WebActivity.this, "已保存到相册: " + name, Toast.LENGTH_SHORT).show();
                        } catch (Exception e) {
                            Toast.makeText(WebActivity.this, "保存失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    }
                });
                return "ok";
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        /** 复制文本到剪贴板（file:// 下网页 clipboard API 受限时走原生） */
        @JavascriptInterface
        public String copyText(final String text) {
            mainHandler.post(new Runnable() {
                public void run() {
                    try {
                        android.content.ClipboardManager cm =
                                (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("text", text));
                        Toast.makeText(WebActivity.this, "已复制到剪贴板", Toast.LENGTH_SHORT).show();
                    } catch (Exception ignored) {}
                }
            });
            return "ok";
        }
    }

    /** 字节写入系统相册（MediaStore，兼容到 API 24） */
    private void saveBytesToPictures(byte[] data, String fileName) {
        OutputStream os = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
                cv.put(MediaStore.Images.Media.MIME_TYPE,
                        fileName.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png");
                cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PNG伪装");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                os = getContentResolver().openOutputStream(uri);
                os.write(data);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_PICTURES), "PNG伪装");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, fileName);
                os = new FileOutputStream(out);
                os.write(data);
            }
        } catch (Exception e) {
            throw new RuntimeException(e);
        } finally {
            try { if (os != null) os.close(); } catch (Exception ignored) {}
        }
    }

    /** 返回键：网页能后退就后退，否则交给系统（退出） */
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
