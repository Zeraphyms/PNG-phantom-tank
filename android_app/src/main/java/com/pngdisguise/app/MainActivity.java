package com.pngdisguise.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RelativeLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int REQ_PICK_SRC_IMAGE = 1001;
    private static final int REQ_PICK_CUSTOM_COVER = 1002;
    private static final int REQ_PICK_DISGUISED_IMAGE = 1003;

    private TextView tabDisguise;
    private TextView tabRestore;
    private TextView tabHelp;
    private View pageDisguise;
    private View pageRestore;
    private View pageHelp;

    private RelativeLayout boxSelectSrc;
    private View layoutSrcPlaceholder;
    private ImageView ivSrcPreview;
    private TextView tvSrcFileInfo;
    private ImageView ivCoverThumb;
    private TextView tvCoverStatus;
    private Button btnChangeCover;
    private TextView btnResetCover;
    private Button btnDoDisguise;
    private View cardDisguiseResult;
    private ImageView ivResultCoverView;
    private ImageView ivResultRealView;
    private TextView tvDisguiseSummary;
    private Button btnSaveDisguise;
    private Button btnShareDisguise;

    private RelativeLayout boxSelectDisguisedFile;
    private View layoutRestorePlaceholder;
    private ImageView ivRestoreSrcPreview;
    private TextView tvRestoreInspectInfo;
    private Button btnDoRestore;
    private View cardRestoreResult;
    private ImageView ivRestoredImage;
    private TextView tvRestoreSummary;
    private Button btnSaveRestored;
    private Button btnShareRestored;

    private Uri srcImageUri;
    private byte[] srcImageBytes;
    private Bitmap srcBitmap;
    private boolean isSrcGif = false;

    private Bitmap defaultCoverBitmap;
    private Bitmap customCoverBitmap;

    private byte[] lastDisguisedBytes;
    private File lastDisguisedFile;

    private Uri restoreImageUri;
    private byte[] restoreImageBytes;
    private byte[] lastRestoredBytes;
    private File lastRestoredFile;
    private Bitmap lastRestoredBitmap;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        setupTabs();
        loadDefaultCover();
        setupEventListeners();
    }

    private void initViews() {
        tabDisguise = (TextView) findViewById(R.id.tab_disguise);
        tabRestore = (TextView) findViewById(R.id.tab_restore);
        tabHelp = (TextView) findViewById(R.id.tab_help);
        pageDisguise = findViewById(R.id.page_disguise);
        pageRestore = findViewById(R.id.page_restore);
        pageHelp = findViewById(R.id.page_help);

        boxSelectSrc = (RelativeLayout) findViewById(R.id.box_select_src);
        layoutSrcPlaceholder = findViewById(R.id.layout_src_placeholder);
        ivSrcPreview = (ImageView) findViewById(R.id.iv_src_preview);
        tvSrcFileInfo = (TextView) findViewById(R.id.tv_src_file_info);
        ivCoverThumb = (ImageView) findViewById(R.id.iv_cover_thumb);
        tvCoverStatus = (TextView) findViewById(R.id.tv_cover_status);
        btnChangeCover = (Button) findViewById(R.id.btn_change_cover);
        btnResetCover = (TextView) findViewById(R.id.btn_reset_cover);
        btnDoDisguise = (Button) findViewById(R.id.btn_do_disguise);
        cardDisguiseResult = findViewById(R.id.card_disguise_result);
        ivResultCoverView = (ImageView) findViewById(R.id.iv_result_cover_view);
        ivResultRealView = (ImageView) findViewById(R.id.iv_result_real_view);
        tvDisguiseSummary = (TextView) findViewById(R.id.tv_disguise_summary);
        btnSaveDisguise = (Button) findViewById(R.id.btn_save_disguise);
        btnShareDisguise = (Button) findViewById(R.id.btn_share_disguise);

        boxSelectDisguisedFile = (RelativeLayout) findViewById(R.id.box_select_disguised_file);
        layoutRestorePlaceholder = findViewById(R.id.layout_restore_placeholder);
        ivRestoreSrcPreview = (ImageView) findViewById(R.id.iv_restore_src_preview);
        tvRestoreInspectInfo = (TextView) findViewById(R.id.tv_restore_inspect_info);
        btnDoRestore = (Button) findViewById(R.id.btn_do_restore);
        cardRestoreResult = findViewById(R.id.card_restore_result);
        ivRestoredImage = (ImageView) findViewById(R.id.iv_restored_image);
        tvRestoreSummary = (TextView) findViewById(R.id.tv_restore_summary);
        btnSaveRestored = (Button) findViewById(R.id.btn_save_restored);
        btnShareRestored = (Button) findViewById(R.id.btn_share_restored);
    }

    private void setupTabs() {
        tabDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(0); }
        });
        tabRestore.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(1); }
        });
        tabHelp.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(2); }
        });
    }

    private void switchTab(int index) {
        pageDisguise.setVisibility(index == 0 ? View.VISIBLE : View.GONE);
        pageRestore.setVisibility(index == 1 ? View.VISIBLE : View.GONE);
        pageHelp.setVisibility(index == 2 ? View.VISIBLE : View.GONE);

        updateTabStyle(tabDisguise, index == 0);
        updateTabStyle(tabRestore, index == 1);
        updateTabStyle(tabHelp, index == 2);
    }

    private void updateTabStyle(TextView tab, boolean active) {
        if (active) {
            tab.setBackgroundResource(R.drawable.tab_active);
            tab.setTextColor(Color.WHITE);
        } else {
            tab.setBackground(null);
            tab.setTextColor(getResources().getColor(R.color.text_secondary));
        }
    }

    private void loadDefaultCover() {
        defaultCoverBitmap = ImageProcessor.getDefaultCover(this);
        if (defaultCoverBitmap != null) {
            ivCoverThumb.setImageBitmap(defaultCoverBitmap);
        }
    }

    private Bitmap getActiveCover() {
        return customCoverBitmap != null ? customCoverBitmap : defaultCoverBitmap;
    }

    private void setupEventListeners() {
        boxSelectSrc.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImage(REQ_PICK_SRC_IMAGE); }
        });
        btnChangeCover.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImage(REQ_PICK_CUSTOM_COVER); }
        });
        btnResetCover.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                customCoverBitmap = null;
                ivCoverThumb.setImageBitmap(defaultCoverBitmap);
                tvCoverStatus.setText("内置官方经典蓝色封面");
                Toast.makeText(MainActivity.this, "已恢复为默认封面", Toast.LENGTH_SHORT).show();
            }
        });

        btnDoDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { doDisguise(); }
        });
        btnSaveDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { saveDisguiseToGallery(); }
        });
        btnShareDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { shareFile(lastDisguisedFile, "image/png"); }
        });

        boxSelectDisguisedFile.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImage(REQ_PICK_DISGUISED_IMAGE); }
        });
        btnDoRestore.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { doRestore(); }
        });
        btnSaveRestored.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { saveRestoredToGallery(); }
        });
        btnShareRestored.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { shareFile(lastRestoredFile, "image/png"); }
        });
    }

    private void pickImage(int requestCode) {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(Intent.createChooser(intent, "选择图片"), requestCode);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            return;
        }

        Uri uri = data.getData();
        if (requestCode == REQ_PICK_SRC_IMAGE) {
            handleSrcImageSelected(uri);
        } else if (requestCode == REQ_PICK_CUSTOM_COVER) {
            handleCustomCoverSelected(uri);
        } else if (requestCode == REQ_PICK_DISGUISED_IMAGE) {
            handleDisguisedFileSelected(uri);
        }
    }

    private void handleSrcImageSelected(Uri uri) {
        try {
            srcImageUri = uri;
            srcImageBytes = readUriBytes(uri);
            isSrcGif = GifDecoder.isGif(srcImageBytes);

            srcBitmap = BitmapFactory.decodeByteArray(srcImageBytes, 0, srcImageBytes.length);
            if (srcBitmap != null) {
                ivSrcPreview.setImageBitmap(srcBitmap);
                ivSrcPreview.setVisibility(View.VISIBLE);
                layoutSrcPlaceholder.setVisibility(View.GONE);

                String type = isSrcGif ? "GIF 动图" : "静态图片";
                tvSrcFileInfo.setText(String.format(Locale.CHINA, "%s | %dx%d | %.1f KB",
                        type, srcBitmap.getWidth(), srcBitmap.getHeight(), srcImageBytes.length / 1024f));
                cardDisguiseResult.setVisibility(View.GONE);
            }
        } catch (Exception e) {
            Toast.makeText(this, "读取图片失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void handleCustomCoverSelected(Uri uri) {
        try {
            byte[] bytes = readUriBytes(uri);
            Bitmap bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bm != null) {
                customCoverBitmap = bm;
                ivCoverThumb.setImageBitmap(bm);
                tvCoverStatus.setText(String.format(Locale.CHINA, "自定义封面: %dx%d", bm.getWidth(), bm.getHeight()));
                Toast.makeText(this, "已设置自定义封面", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "读取封面图片失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void handleDisguisedFileSelected(Uri uri) {
        try {
            restoreImageUri = uri;
            restoreImageBytes = readUriBytes(uri);

            Bitmap bm = BitmapFactory.decodeByteArray(restoreImageBytes, 0, restoreImageBytes.length);
            if (bm != null) {
                ivRestoreSrcPreview.setImageBitmap(bm);
                ivRestoreSrcPreview.setVisibility(View.VISIBLE);
                layoutRestorePlaceholder.setVisibility(View.GONE);
            }

            ApngCodec.DisguiseInfo info = ApngCodec.inspectDisguise(restoreImageBytes);
            tvRestoreInspectInfo.setVisibility(View.VISIBLE);
            if (info != null) {
                String kindStr = "STATIC".equals(info.meta.kind) ? "静态隐写" : "GIF动图隐写";
                tvRestoreInspectInfo.setText(String.format(Locale.CHINA, "✔ 识别为伪装 APNG (%s, 隐藏%d帧, 尺寸 %dx%d)",
                        kindStr, info.meta.count, info.width, info.height));
                tvRestoreInspectInfo.setTextColor(getResources().getColor(R.color.success));
            } else {
                tvRestoreInspectInfo.setText("ℹ 未检测到标准隐写特征，尝试强制解析还原");
                tvRestoreInspectInfo.setTextColor(getResources().getColor(R.color.warning));
            }
            cardRestoreResult.setVisibility(View.GONE);
        } catch (Exception e) {
            Toast.makeText(this, "加载文件失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void doDisguise() {
        if (srcImageBytes == null || srcBitmap == null) {
            Toast.makeText(this, "请先选择需要伪装的图片", Toast.LENGTH_SHORT).show();
            return;
        }

        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("正在编码生成 APNG 伪装图片...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            public void run() {
                try {
                    Bitmap cover = getActiveCover();
                    final byte[] result;
                    if (isSrcGif) {
                        result = ImageProcessor.disguiseGif(srcImageBytes, cover, null);
                    } else {
                        result = ImageProcessor.disguiseStatic(srcBitmap, cover, null);
                    }
                    lastDisguisedBytes = result;

                    File cacheDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    if (cacheDir == null) cacheDir = getFilesDir();
                    String fileName = "disguised_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date()) + ".png";
                    lastDisguisedFile = new File(cacheDir, fileName);
                    FileOutputStream fos = new FileOutputStream(lastDisguisedFile);
                    fos.write(result);
                    fos.close();

                    final Bitmap coverCanvas = ImageProcessor.makeCover(srcBitmap.getWidth(), srcBitmap.getHeight(), cover, null);

                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            cardDisguiseResult.setVisibility(View.VISIBLE);
                            ivResultCoverView.setImageBitmap(coverCanvas);
                            ivResultRealView.setImageBitmap(srcBitmap);
                            tvDisguiseSummary.setText(String.format(Locale.CHINA,
                                    "伪装完成！格式: APNG (.png) | 尺寸: %dx%d | 大小: %.1f KB",
                                    srcBitmap.getWidth(), srcBitmap.getHeight(), result.length / 1024f));
                            Toast.makeText(MainActivity.this, "伪装成功！可保存到相册或直接发送", Toast.LENGTH_LONG).show();
                        }
                    });
                } catch (final Exception e) {
                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("伪装失败")
                                    .setMessage(e.getMessage() != null ? e.getMessage() : e.toString())
                                    .setPositiveButton("确定", null)
                                    .show();
                        }
                    });
                }
            }
        }).start();
    }

    private void doRestore() {
        if (restoreImageBytes == null) {
            Toast.makeText(this, "请先选择需要还原的伪装图片", Toast.LENGTH_SHORT).show();
            return;
        }

        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("正在提取隐藏图片数据...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            public void run() {
                try {
                    final byte[] restored = ImageProcessor.restoreDisguise(restoreImageBytes);
                    lastRestoredBytes = restored;

                    File cacheDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    if (cacheDir == null) cacheDir = getFilesDir();
                    String fileName = "restored_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date()) + ".png";
                    lastRestoredFile = new File(cacheDir, fileName);
                    FileOutputStream fos = new FileOutputStream(lastRestoredFile);
                    fos.write(restored);
                    fos.close();

                    final Bitmap restoredBm = BitmapFactory.decodeByteArray(restored, 0, restored.length);
                    lastRestoredBitmap = restoredBm;

                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            cardRestoreResult.setVisibility(View.VISIBLE);
                            if (restoredBm != null) {
                                ivRestoredImage.setImageBitmap(restoredBm);
                                tvRestoreSummary.setText(String.format(Locale.CHINA,
                                        "还原成功！尺寸: %dx%d | 大小: %.1f KB",
                                        restoredBm.getWidth(), restoredBm.getHeight(), restored.length / 1024f));
                            } else {
                                tvRestoreSummary.setText(String.format(Locale.CHINA,
                                        "还原成功！动画 APNG | 大小: %.1f KB", restored.length / 1024f));
                            }
                            Toast.makeText(MainActivity.this, "真实图片提取成功！", Toast.LENGTH_SHORT).show();
                        }
                    });
                } catch (final Exception e) {
                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("还原失败")
                                    .setMessage("未能从该文件中还原出有效图片，请确保文件是本工具伪装的完整文件。\n详情: " + e.getMessage())
                                    .setPositiveButton("确定", null)
                                    .show();
                        }
                    });
                }
            }
        }).start();
    }

    private void saveDisguiseToGallery() {
        if (lastDisguisedBytes == null) return;
        saveBytesToPictures(lastDisguisedBytes, "disguised_apng.png");
    }

    private void saveRestoredToGallery() {
        if (lastRestoredBytes == null) return;
        saveBytesToPictures(lastRestoredBytes, "restored_real.png");
    }

    private void saveBytesToPictures(byte[] data, String prefix) {
        try {
            String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date());
            String fileName = prefix.replace(".png", "") + "_" + timeStamp + ".png";

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PNG伪装");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            ContentResolver resolver = getContentResolver();
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri != null) {
                OutputStream os = resolver.openOutputStream(uri);
                if (os != null) {
                    os.write(data);
                    os.close();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                }
                Toast.makeText(this, "已保存到相册 Pictures/PNG伪装 目录", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "创建相册文件失败", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "保存失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void shareFile(File file, String mimeType) {
        if (file == null || !file.exists()) {
            Toast.makeText(this, "文件未就绪", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Uri contentUri = AppFileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType(mimeType);
            shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(shareIntent, "发送文件到..."));
        } catch (Exception e) {
            Toast.makeText(this, "分享失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private byte[] readUriBytes(Uri uri) throws Exception {
        InputStream is = getContentResolver().openInputStream(uri);
        if (is == null) throw new Exception("无法打开输入流");
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int len;
        while ((len = is.read(buf)) != -1) {
            bos.write(buf, 0, len);
        }
        bos.close();
        is.close();
        return bos.toByteArray();
    }
}
