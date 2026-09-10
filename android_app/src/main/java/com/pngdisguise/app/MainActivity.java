package com.pngdisguise.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RelativeLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int REQ_PICK_SRC_IMAGE = 1001;
    private static final int REQ_PICK_CUSTOM_COVER = 1002;
    private static final int REQ_PICK_DISGUISED_IMAGE = 1003;

    private static final String PREF_NAME = "png_disguise_prefs";
    private static final String KEY_PERSIST_COVER = "persist_cover";
    private static final String SAVED_COVER_FILENAME = "saved_custom_cover.png";

    private TextView tabDisguise;
    private TextView tabRestore;
    private TextView tabHistory;
    private TextView tabHelp;
    private View pageDisguise;
    private View pageRestore;
    private View pageHistory;
    private View pageHelp;

    // Disguise Views
    private RelativeLayout boxSelectSrc;
    private View layoutSrcPlaceholder;
    private ImageView ivSrcPreview;
    private TextView tvSrcFileInfo;
    private ImageView ivCoverThumb;
    private TextView tvCoverStatus;
    private Button btnChangeCover;
    private Button btnSaveCover;
    private TextView btnResetCover;
    private Button btnDoDisguise;
    private View cardDisguiseResult;
    private TextView tvDisguiseResultTitle;
    private ImageView ivResultCoverView;
    private ImageView ivResultRealView;
    private TextView tvDisguiseSummary;
    private Button btnSaveDisguise;
    private Button btnShareDisguise;

    // Restore Views
    private RelativeLayout boxSelectDisguisedFile;
    private View layoutRestorePlaceholder;
    private ImageView ivRestoreSrcPreview;
    private TextView tvRestoreFileCountHint;
    private TextView tvRestoreInspectInfo;
    private Button btnDoRestore;
    private View cardRestoreResult;
    private TextView tvRestoreResultTitle;
    private ImageView ivRestoredImage;
    private TextView tvRestoreSummary;
    private Button btnSaveRestored;
    private Button btnShareRestored;

    // History Views
    private TextView tvCacheStat;
    private Button btnClearAllCache;
    private View layoutHistoryEmpty;
    private LinearLayout llHistoryContainer;

    // Help View
    private TextView tvProjectLink;

    // States for Disguise
    private final List<Uri> srcUris = new ArrayList<>();
    private Bitmap firstSrcBitmap;

    private Bitmap defaultCoverBitmap;
    private Bitmap customCoverBitmap;

    private final List<byte[]> lastDisguisedBytesList = new ArrayList<>();
    private final List<File> lastDisguisedFileList = new ArrayList<>();

    // States for Restore
    private final List<Uri> restoreUris = new ArrayList<>();
    private final List<byte[]> lastRestoredBytesList = new ArrayList<>();
    private final List<File> lastRestoredFileList = new ArrayList<>();
    private Bitmap firstRestoredBitmap;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        initViews();
        setupTabs();
        initCoverSettings();
        setupEventListeners();
    }

    private void initViews() {
        tabDisguise = (TextView) findViewById(R.id.tab_disguise);
        tabRestore = (TextView) findViewById(R.id.tab_restore);
        tabHistory = (TextView) findViewById(R.id.tab_history);
        tabHelp = (TextView) findViewById(R.id.tab_help);
        pageDisguise = findViewById(R.id.page_disguise);
        pageRestore = findViewById(R.id.page_restore);
        pageHistory = findViewById(R.id.page_history);
        pageHelp = findViewById(R.id.page_help);

        boxSelectSrc = (RelativeLayout) findViewById(R.id.box_select_src);
        layoutSrcPlaceholder = findViewById(R.id.layout_src_placeholder);
        ivSrcPreview = (ImageView) findViewById(R.id.iv_src_preview);
        tvSrcFileInfo = (TextView) findViewById(R.id.tv_src_file_info);
        ivCoverThumb = (ImageView) findViewById(R.id.iv_cover_thumb);
        tvCoverStatus = (TextView) findViewById(R.id.tv_cover_status);
        btnChangeCover = (Button) findViewById(R.id.btn_change_cover);
        btnSaveCover = (Button) findViewById(R.id.btn_save_cover);
        btnResetCover = (TextView) findViewById(R.id.btn_reset_cover);
        btnDoDisguise = (Button) findViewById(R.id.btn_do_disguise);
        cardDisguiseResult = findViewById(R.id.card_disguise_result);
        tvDisguiseResultTitle = (TextView) findViewById(R.id.tv_disguise_result_title);
        ivResultCoverView = (ImageView) findViewById(R.id.iv_result_cover_view);
        ivResultRealView = (ImageView) findViewById(R.id.iv_result_real_view);
        tvDisguiseSummary = (TextView) findViewById(R.id.tv_disguise_summary);
        btnSaveDisguise = (Button) findViewById(R.id.btn_save_disguise);
        btnShareDisguise = (Button) findViewById(R.id.btn_share_disguise);

        boxSelectDisguisedFile = (RelativeLayout) findViewById(R.id.box_select_disguised_file);
        layoutRestorePlaceholder = findViewById(R.id.layout_restore_placeholder);
        ivRestoreSrcPreview = (ImageView) findViewById(R.id.iv_restore_src_preview);
        tvRestoreFileCountHint = (TextView) findViewById(R.id.tv_restore_file_count_hint);
        tvRestoreInspectInfo = (TextView) findViewById(R.id.tv_restore_inspect_info);
        btnDoRestore = (Button) findViewById(R.id.btn_do_restore);
        cardRestoreResult = findViewById(R.id.card_restore_result);
        tvRestoreResultTitle = (TextView) findViewById(R.id.tv_restore_result_title);
        ivRestoredImage = (ImageView) findViewById(R.id.iv_restored_image);
        tvRestoreSummary = (TextView) findViewById(R.id.tv_restore_summary);
        btnSaveRestored = (Button) findViewById(R.id.btn_save_restored);
        btnShareRestored = (Button) findViewById(R.id.btn_share_restored);

        tvCacheStat = (TextView) findViewById(R.id.tv_cache_stat);
        btnClearAllCache = (Button) findViewById(R.id.btn_clear_all_cache);
        layoutHistoryEmpty = findViewById(R.id.layout_history_empty);
        llHistoryContainer = (LinearLayout) findViewById(R.id.ll_history_container);

        tvProjectLink = (TextView) findViewById(R.id.tv_project_link);
    }

    private void setupTabs() {
        tabDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(0); }
        });
        tabRestore.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(1); }
        });
        tabHistory.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(2); }
        });
        tabHelp.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { switchTab(3); }
        });
    }

    private void switchTab(int index) {
        pageDisguise.setVisibility(index == 0 ? View.VISIBLE : View.GONE);
        pageRestore.setVisibility(index == 1 ? View.VISIBLE : View.GONE);
        pageHistory.setVisibility(index == 2 ? View.VISIBLE : View.GONE);
        pageHelp.setVisibility(index == 3 ? View.VISIBLE : View.GONE);

        updateTabStyle(tabDisguise, index == 0);
        updateTabStyle(tabRestore, index == 1);
        updateTabStyle(tabHistory, index == 2);
        updateTabStyle(tabHelp, index == 3);

        if (index == 2) {
            refreshHistoryList();
        }
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

    private void initCoverSettings() {
        defaultCoverBitmap = ImageProcessor.getDefaultCover(this);

        SharedPreferences sp = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
        boolean shouldPersist = sp.getBoolean(KEY_PERSIST_COVER, false);

        if (shouldPersist) {
            File savedCoverFile = new File(getFilesDir(), SAVED_COVER_FILENAME);
            if (savedCoverFile.exists()) {
                try {
                    Bitmap savedBm = BitmapFactory.decodeFile(savedCoverFile.getAbsolutePath());
                    if (savedBm != null) {
                        customCoverBitmap = savedBm;
                        ivCoverThumb.setImageBitmap(savedBm);
                        tvCoverStatus.setText(String.format(Locale.CHINA, "自定义封面 [已持久保存]: %dx%d", savedBm.getWidth(), savedBm.getHeight()));
                        return;
                    }
                } catch (Exception ignored) {}
            }
        }

        if (defaultCoverBitmap != null) {
            ivCoverThumb.setImageBitmap(defaultCoverBitmap);
        }
        tvCoverStatus.setText("内置官方经典蓝色封面 (默认)");
    }

    private void saveCustomCoverToFile(Bitmap bm) {
        try {
            File savedCoverFile = new File(getFilesDir(), SAVED_COVER_FILENAME);
            FileOutputStream fos = new FileOutputStream(savedCoverFile);
            bm.compress(Bitmap.CompressFormat.PNG, 100, fos);
            fos.flush();
            fos.close();
        } catch (Exception ignored) {}
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
        // Disguise Page
        boxSelectSrc.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImages(REQ_PICK_SRC_IMAGE, true); }
        });
        btnChangeCover.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImages(REQ_PICK_CUSTOM_COVER, false); }
        });
        btnResetCover.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                customCoverBitmap = null;
                ivCoverThumb.setImageBitmap(defaultCoverBitmap);
                tvCoverStatus.setText("内置官方经典蓝色封面 (默认)");
                SharedPreferences sp = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
                sp.edit().putBoolean(KEY_PERSIST_COVER, false).apply();
                File savedCoverFile = new File(getFilesDir(), SAVED_COVER_FILENAME);
                if (savedCoverFile.exists()) {
                    savedCoverFile.delete();
                }
                Toast.makeText(MainActivity.this, "已恢复并保存为官方默认封面", Toast.LENGTH_SHORT).show();
            }
        });

        btnSaveCover.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                if (customCoverBitmap == null) {
                    Toast.makeText(MainActivity.this, "当前为官方默认封面，无需重复保存", Toast.LENGTH_SHORT).show();
                    return;
                }
                saveCustomCoverToFile(customCoverBitmap);
                SharedPreferences sp = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
                sp.edit().putBoolean(KEY_PERSIST_COVER, true).apply();
                tvCoverStatus.setText(String.format(Locale.CHINA, "自定义封面 [已持久保存]: %dx%d", customCoverBitmap.getWidth(), customCoverBitmap.getHeight()));
                Toast.makeText(MainActivity.this, "已永久保存当前封面配置，重启后依然生效！", Toast.LENGTH_SHORT).show();
            }
        });

        btnDoDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { doDisguise(); }
        });
        btnSaveDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { saveDisguisesToGallery(); }
        });
        btnShareDisguise.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { shareFiles(lastDisguisedFileList, "image/png"); }
        });

        // Restore Page
        boxSelectDisguisedFile.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { pickImages(REQ_PICK_DISGUISED_IMAGE, true); }
        });
        btnDoRestore.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { doRestore(); }
        });
        btnSaveRestored.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { saveRestoredToGallery(); }
        });
                btnClearAllCache.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                confirmClearAllCache();
            }
        });

        btnShareRestored.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { shareFiles(lastRestoredFileList, "image/png"); }
        });

        // Project Link in Help
        if (tvProjectLink != null) {
            tvProjectLink.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://github.com/Zeraphyms/PNG-phantom-tank"));
                        startActivity(browserIntent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "无法打开浏览器", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    private void pickImages(int requestCode, boolean allowMultiple) {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        if (allowMultiple) {
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        startActivityForResult(Intent.createChooser(intent, allowMultiple ? "选择图片 (可多选)" : "选择图片"), requestCode);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) {
            return;
        }

        List<Uri> selectedUris = new ArrayList<>();
        if (data.getClipData() != null) {
            ClipData clip = data.getClipData();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri itemUri = clip.getItemAt(i).getUri();
                if (itemUri != null) {
                    selectedUris.add(itemUri);
                }
            }
        } else if (data.getData() != null) {
            selectedUris.add(data.getData());
        }

        if (selectedUris.isEmpty()) return;

        if (requestCode == REQ_PICK_SRC_IMAGE) {
            handleSrcImagesSelected(selectedUris);
        } else if (requestCode == REQ_PICK_CUSTOM_COVER) {
            handleCustomCoverSelected(selectedUris.get(0));
        } else if (requestCode == REQ_PICK_DISGUISED_IMAGE) {
            handleDisguisedFilesSelected(selectedUris);
        }
    }

    private void handleSrcImagesSelected(List<Uri> uris) {
        srcUris.clear();
        srcUris.addAll(uris);

        try {
            byte[] firstBytes = readUriBytes(srcUris.get(0));
            firstSrcBitmap = BitmapFactory.decodeByteArray(firstBytes, 0, firstBytes.length);
            if (firstSrcBitmap != null) {
                ivSrcPreview.setImageBitmap(firstSrcBitmap);
                ivSrcPreview.setVisibility(View.VISIBLE);
                layoutSrcPlaceholder.setVisibility(View.GONE);
            }

            int count = srcUris.size();
            if (count == 1) {
                boolean isGif = GifDecoder.isGif(firstBytes);
                String type = isGif ? "GIF 动图" : "静态图片";
                tvSrcFileInfo.setText(String.format(Locale.CHINA, "已选单张: %s | %dx%d | %.1f KB",
                        type, firstSrcBitmap != null ? firstSrcBitmap.getWidth() : 0,
                        firstSrcBitmap != null ? firstSrcBitmap.getHeight() : 0,
                        firstBytes.length / 1024f));
            } else {
                tvSrcFileInfo.setText(String.format(Locale.CHINA, "已批量选择 %d 张图片 (封面将自动生成序号)", count));
            }
            cardDisguiseResult.setVisibility(View.GONE);
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
                tvCoverStatus.setText(String.format(Locale.CHINA, "自定义封面 [单次更改未保存]: %dx%d", bm.getWidth(), bm.getHeight()));
                Toast.makeText(this, "已更换封面（单次有效，如需重启依然生效请点击「保存当前封面」）", Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "读取封面图片失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void handleDisguisedFilesSelected(List<Uri> uris) {
        restoreUris.clear();
        restoreUris.addAll(uris);

        try {
            byte[] firstBytes = readUriBytes(restoreUris.get(0));
            Bitmap bm = BitmapFactory.decodeByteArray(firstBytes, 0, firstBytes.length);
            if (bm != null) {
                ivRestoreSrcPreview.setImageBitmap(bm);
                ivRestoreSrcPreview.setVisibility(View.VISIBLE);
                layoutRestorePlaceholder.setVisibility(View.GONE);
            }

            int count = restoreUris.size();
            tvRestoreFileCountHint.setText(String.format(Locale.CHINA, "已选 %d 个文件准备还原", count));

            ApngCodec.DisguiseInfo info = ApngCodec.inspectDisguise(firstBytes);
            tvRestoreInspectInfo.setVisibility(View.VISIBLE);
            if (count == 1) {
                if (info != null) {
                    String kindStr = "STATIC".equals(info.meta.kind) ? "静态隐写" : ("ANIMATED".equals(info.meta.kind) ? "动图隐写" : "标准隐藏帧");
                    tvRestoreInspectInfo.setText(String.format(Locale.CHINA, "✔ 识别为伪装 APNG (%s, 隐藏%d帧, 尺寸 %dx%d)",
                            kindStr, info.meta.count, info.width, info.height));
                    tvRestoreInspectInfo.setTextColor(getResources().getColor(R.color.success));
                } else {
                    tvRestoreInspectInfo.setText("ℹ 未检测到标准隐写特征，尝试直接提取");
                    tvRestoreInspectInfo.setTextColor(getResources().getColor(R.color.warning));
                }
            } else {
                tvRestoreInspectInfo.setText(String.format(Locale.CHINA, "已批量选择 %d 个待还原文件，点击下方按钮一键批量还原", count));
                tvRestoreInspectInfo.setTextColor(getResources().getColor(R.color.primary));
            }
            cardRestoreResult.setVisibility(View.GONE);
        } catch (Exception e) {
            Toast.makeText(this, "加载文件失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void doDisguise() {
        if (srcUris.isEmpty()) {
            Toast.makeText(this, "请先选择需要伪装的图片", Toast.LENGTH_SHORT).show();
            return;
        }

        final int totalCount = srcUris.size();
        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("正在准备伪装图片 (0/" + totalCount + ")...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            public void run() {
                try {
                    lastDisguisedBytesList.clear();
                    lastDisguisedFileList.clear();

                    Bitmap cover = getActiveCover();
                    File cacheDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    if (cacheDir == null) cacheDir = getFilesDir();
                    String timeBase = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date());

                    for (int i = 0; i < totalCount; i++) {
                        final int currentIdx = i + 1;
                        mainHandler.post(new Runnable() {
                            public void run() {
                                progress.setMessage(String.format(Locale.CHINA, "正在伪装第 %d/%d 张图片...", currentIdx, totalCount));
                            }
                        });

                        Uri uri = srcUris.get(i);
                        byte[] bytes = readUriBytes(uri);
                        boolean isGif = GifDecoder.isGif(bytes);

                        Integer badge = (totalCount > 1) ? currentIdx : null;
                        byte[] result;
                        if (isGif) {
                            result = ImageProcessor.disguiseGif(bytes, cover, badge);
                        } else {
                            Bitmap bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                            if (bm == null) continue;
                            result = ImageProcessor.disguiseStatic(bm, cover, badge);
                        }

                        lastDisguisedBytesList.add(result);

                        String fileName = String.format(Locale.CHINA, "%03d_disguised_%s.png", currentIdx, timeBase);
                        File historyDir = getHistoryStorageDir();
                        File outFile = new File(historyDir, fileName);
                        FileOutputStream fos = new FileOutputStream(outFile);
                        fos.write(result);
                        fos.close();
                        lastDisguisedFileList.add(outFile);
                    }

                    // 预览图生成第一张的封面和内容
                    final Bitmap previewCover = (firstSrcBitmap != null) ?
                            ImageProcessor.makeCover(firstSrcBitmap.getWidth(), firstSrcBitmap.getHeight(), cover, totalCount > 1 ? 1 : null) : null;

                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            cardDisguiseResult.setVisibility(View.VISIBLE);
                            if (previewCover != null) {
                                ivResultCoverView.setImageBitmap(previewCover);
                            }
                            if (firstSrcBitmap != null) {
                                ivResultRealView.setImageBitmap(firstSrcBitmap);
                            }

                            if (totalCount == 1) {
                                tvDisguiseResultTitle.setText("🎉 伪装生成成功 (双重视角预览)");
                                byte[] res = lastDisguisedBytesList.get(0);
                                tvDisguiseSummary.setText(String.format(Locale.CHINA,
                                        "单张伪装完成！格式: APNG (.png) | 大小: %.1f KB", res.length / 1024f));
                            } else {
                                tvDisguiseResultTitle.setText(String.format(Locale.CHINA, "🎉 批量伪装完成 (共 %d 张，封面带序号)", totalCount));
                                tvDisguiseSummary.setText(String.format(Locale.CHINA,
                                        "成功生成 %d 张 APNG 伪装图片 (左图展示第1张封面序号效果)", totalCount));
                            }
                            Toast.makeText(MainActivity.this, "伪装完成！可全部保存到相册或批量发送", Toast.LENGTH_LONG).show();
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
        if (restoreUris.isEmpty()) {
            Toast.makeText(this, "请先选择需要还原的伪装图片", Toast.LENGTH_SHORT).show();
            return;
        }

        final int totalCount = restoreUris.size();
        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("正在提取隐藏图片 (0/" + totalCount + ")...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            public void run() {
                try {
                    lastRestoredBytesList.clear();
                    lastRestoredFileList.clear();

                    File cacheDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    if (cacheDir == null) cacheDir = getFilesDir();
                    String timeBase = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date());

                    int successCount = 0;
                    for (int i = 0; i < totalCount; i++) {
                        final int currentIdx = i + 1;
                        mainHandler.post(new Runnable() {
                            public void run() {
                                progress.setMessage(String.format(Locale.CHINA, "正在提取第 %d/%d 张隐藏真图...", currentIdx, totalCount));
                            }
                        });

                        Uri uri = restoreUris.get(i);
                        byte[] bytes = readUriBytes(uri);

                        byte[] restored;
                        try {
                            restored = ImageProcessor.restoreDisguise(bytes);
                        } catch (Exception e) {
                            continue;
                        }

                        lastRestoredBytesList.add(restored);
                        successCount++;

                        String fileName = String.format(Locale.CHINA, "%03d_restored_%s.png", currentIdx, timeBase);
                        File historyDir = getHistoryStorageDir();
                        File outFile = new File(historyDir, fileName);
                        FileOutputStream fos = new FileOutputStream(outFile);
                        fos.write(restored);
                        fos.close();
                        lastRestoredFileList.add(outFile);

                        if (firstRestoredBitmap == null) {
                            firstRestoredBitmap = BitmapFactory.decodeByteArray(restored, 0, restored.length);
                        }
                    }

                    final int finalSuccess = successCount;
                    mainHandler.post(new Runnable() {
                        public void run() {
                            progress.dismiss();
                            if (finalSuccess == 0) {
                                Toast.makeText(MainActivity.this, "未能从所选文件中还原出有效图片", Toast.LENGTH_LONG).show();
                                return;
                            }
                            cardRestoreResult.setVisibility(View.VISIBLE);
                            if (firstRestoredBitmap != null) {
                                ivRestoredImage.setImageBitmap(firstRestoredBitmap);
                            }

                            if (totalCount == 1) {
                                tvRestoreResultTitle.setText("✨ 成功提取还原真实图片");
                                byte[] res = lastRestoredBytesList.get(0);
                                tvRestoreSummary.setText(String.format(Locale.CHINA,
                                        "还原成功！格式: PNG | 大小: %.1f KB", res.length / 1024f));
                            } else {
                                tvRestoreResultTitle.setText(String.format(Locale.CHINA, "✨ 批量还原完成 (成功提取 %d/%d 张)", finalSuccess, totalCount));
                                tvRestoreSummary.setText(String.format(Locale.CHINA,
                                        "共成功提取 %d 张真实图片，可一键全部保存或批量发送分享", finalSuccess));
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
                                    .setMessage("提取过程中发生错误: " + e.getMessage())
                                    .setPositiveButton("确定", null)
                                    .show();
                        }
                    });
                }
            }
        }).start();
    }

    private void saveDisguisesToGallery() {
        if (lastDisguisedBytesList.isEmpty()) {
            Toast.makeText(this, "暂无生成的伪装图片可保存", Toast.LENGTH_SHORT).show();
            return;
        }
        saveBytesListToPictures(lastDisguisedBytesList, "disguised");
    }

    private void saveRestoredToGallery() {
        if (lastRestoredBytesList.isEmpty()) {
            Toast.makeText(this, "暂无还原的图片可保存", Toast.LENGTH_SHORT).show();
            return;
        }
        saveBytesListToPictures(lastRestoredBytesList, "restored");
    }

    private void saveBytesListToPictures(List<byte[]> list, String prefix) {
        int savedCount = 0;
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.CHINA).format(new Date());
        ContentResolver resolver = getContentResolver();

        for (int i = 0; i < list.size(); i++) {
            byte[] data = list.get(i);
            String fileName = String.format(Locale.CHINA, "%s_%s_%03d.png", prefix, timeStamp, i + 1);

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PNG伪装");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            try {
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
                    savedCount++;
                }
            } catch (Exception ignored) {}
        }

        if (savedCount > 0) {
            Toast.makeText(this, String.format(Locale.CHINA, "已成功保存 %d 张图片到相册 Pictures/PNG伪装 目录", savedCount), Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "保存到相册失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void shareFiles(List<File> files, String mimeType) {
        if (files == null || files.isEmpty()) {
            Toast.makeText(this, "文件尚未生成，无法分享", Toast.LENGTH_SHORT).show();
            return;
        }

        try {
            if (files.size() == 1) {
                Uri contentUri = AppFileProvider.getUriForFile(this, getPackageName() + ".fileprovider", files.get(0));
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(shareIntent, "发送文件到..."));
            } else {
                ArrayList<Uri> uriList = new ArrayList<>();
                for (File f : files) {
                    uriList.add(AppFileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f));
                }
                Intent shareIntent = new Intent(Intent.ACTION_SEND_MULTIPLE);
                shareIntent.setType(mimeType);
                shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uriList);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(shareIntent, "批量发送文件到..."));
            }
        } catch (Exception e) {
            Toast.makeText(this, "分享失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private File getHistoryStorageDir() {
        File baseDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (baseDir == null) baseDir = getFilesDir();
        File historyDir = new File(baseDir, "history");
        if (!historyDir.exists()) {
            historyDir.mkdirs();
        }
        return historyDir;
    }

    private void saveSingleFileToGallery(File file) {
        try {
            byte[] data = readFileToBytes(file);
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, file.getName());
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
                Toast.makeText(this, "已保存到相册 Pictures/PNG伪装", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "保存到相册失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private List<File> getAllCachedFiles() {
        List<File> list = new ArrayList<>();
        File historyDir = getHistoryStorageDir();
        if (historyDir.exists() && historyDir.isDirectory()) {
            File[] files = historyDir.listFiles();
            if (files != null) {
                list.addAll(Arrays.asList(files));
            }
        }
        File baseDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (baseDir != null && baseDir.exists() && baseDir.isDirectory()) {
            File[] oldFiles = baseDir.listFiles();
            if (oldFiles != null) {
                for (File f : oldFiles) {
                    if (f.isFile() && f.getName().endsWith(".png") && (f.getName().contains("disguised") || f.getName().contains("restored"))) {
                        list.add(f);
                    }
                }
            }
        }
        Collections.sort(list, new Comparator<File>() {
            @Override
            public int compare(File f1, File f2) {
                return Long.compare(f2.lastModified(), f1.lastModified());
            }
        });
        return list;
    }

    private void refreshHistoryList() {
        List<File> files = getAllCachedFiles();
        long totalSize = 0;
        for (File f : files) {
            totalSize += f.length();
        }

        if (files.isEmpty()) {
            tvCacheStat.setText("当前暂无本地图片缓存 (0 B)");
            layoutHistoryEmpty.setVisibility(View.VISIBLE);
            llHistoryContainer.removeAllViews();
            return;
        }

        layoutHistoryEmpty.setVisibility(View.GONE);
        String sizeStr = formatFileSize(totalSize);
        tvCacheStat.setText(String.format(Locale.CHINA, "已缓存 %d 个历史文件 (共占用 %s 存储空间)", files.size(), sizeStr));

        llHistoryContainer.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA);

        for (final File file : files) {
            View itemView = inflater.inflate(R.layout.item_history, llHistoryContainer, false);
            ImageView ivThumb = (ImageView) itemView.findViewById(R.id.iv_history_thumb);
            TextView tvTag = (TextView) itemView.findViewById(R.id.tv_history_tag);
            TextView tvTitle = (TextView) itemView.findViewById(R.id.tv_history_title);
            TextView tvMeta = (TextView) itemView.findViewById(R.id.tv_history_meta);

            TextView btnPreview = (TextView) itemView.findViewById(R.id.btn_history_preview);
            TextView btnShare = (TextView) itemView.findViewById(R.id.btn_history_share);
            TextView btnSave = (TextView) itemView.findViewById(R.id.btn_history_save);
            TextView btnDelete = (TextView) itemView.findViewById(R.id.btn_history_delete);

            final boolean isDisguise = file.getName().contains("disguised");
            if (isDisguise) {
                tvTag.setText("伪装图");
                tvTag.setBackgroundResource(R.drawable.bg_badge_disguised);
                tvTag.setTextColor(getResources().getColor(R.color.primary));
            } else {
                tvTag.setText("还原真图");
                tvTag.setBackgroundResource(R.drawable.bg_badge_restored);
                tvTag.setTextColor(Color.parseColor("#059669"));
            }

            tvTitle.setText(file.getName());
            String dateStr = sdf.format(new Date(file.lastModified()));
            tvMeta.setText(String.format(Locale.CHINA, "大小: %s | 时间: %s", formatFileSize(file.length()), dateStr));

            loadThumbnailAsync(file, ivThumb);

            btnPreview.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    showPreviewDialog(file);
                }
            });

            btnShare.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    List<File> singleList = new ArrayList<>();
                    singleList.add(file);
                    shareFiles(singleList, "image/png");
                }
            });

            btnSave.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    saveSingleFileToGallery(file);
                }
            });

            btnDelete.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("删除记录")
                            .setMessage("确定要删除此条缓存记录吗？\n" + file.getName())
                            .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                                public void onClick(DialogInterface dialog, int which) {
                                    file.delete();
                                    Toast.makeText(MainActivity.this, "已删除该条记录", Toast.LENGTH_SHORT).show();
                                    refreshHistoryList();
                                }
                            })
                            .setNegativeButton("取消", null)
                            .show();
                }
            });

            llHistoryContainer.addView(itemView);
        }
    }

    private void loadThumbnailAsync(final File file, final ImageView iv) {
        new Thread(new Runnable() {
            public void run() {
                try {
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inJustDecodeBounds = true;
                    BitmapFactory.decodeFile(file.getAbsolutePath(), opts);

                    int reqW = 120, reqH = 120;
                    int inSampleSize = 1;
                    if (opts.outHeight > reqH || opts.outWidth > reqW) {
                        int halfH = opts.outHeight / 2;
                        int halfW = opts.outWidth / 2;
                        while ((halfH / inSampleSize) >= reqH && (halfW / inSampleSize) >= reqW) {
                            inSampleSize *= 2;
                        }
                    }
                    opts.inSampleSize = inSampleSize;
                    opts.inJustDecodeBounds = false;
                    final Bitmap thumb = BitmapFactory.decodeFile(file.getAbsolutePath(), opts);

                    if (thumb != null) {
                        mainHandler.post(new Runnable() {
                            public void run() {
                                iv.setImageBitmap(thumb);
                            }
                        });
                    }
                } catch (Exception ignored) {}
            }
        }).start();
    }

    private void showPreviewDialog(File file) {
        try {
            Dialog dialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            ImageView imageView = new ImageView(this);
            imageView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
            imageView.setBackgroundColor(Color.BLACK);

            Bitmap bm = BitmapFactory.decodeFile(file.getAbsolutePath());
            if (bm != null) {
                imageView.setImageBitmap(bm);
            } else {
                Toast.makeText(this, "图片解析失败", Toast.LENGTH_SHORT).show();
                return;
            }

            imageView.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    dialog.dismiss();
                }
            });

            dialog.setContentView(imageView);
            dialog.show();
        } catch (Exception e) {
            Toast.makeText(this, "打开大图预览失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void confirmClearAllCache() {
        final List<File> files = getAllCachedFiles();
        if (files.isEmpty()) {
            Toast.makeText(this, "当前无任何缓存文件需要清理", Toast.LENGTH_SHORT).show();
            return;
        }

        new AlertDialog.Builder(this)
                .setTitle("⚠️ 清理全部历史缓存")
                .setMessage(String.format(Locale.CHINA, "确定要清理全部 %d 个历史文件缓存吗？\n\n注意：清理后将彻底释放本地缓存空间。如果需要保留图片，请先点击「存入相册」。", files.size()))
                .setPositiveButton("立即清空", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dialog, int which) {
                        int deleted = 0;
                        for (File f : files) {
                            if (f.delete()) deleted++;
                        }
                        lastDisguisedFileList.clear();
                        lastDisguisedBytesList.clear();
                        lastRestoredFileList.clear();
                        lastRestoredBytesList.clear();
                        refreshHistoryList();
                        Toast.makeText(MainActivity.this, String.format(Locale.CHINA, "已成功清除 %d 个历史缓存文件！", deleted), Toast.LENGTH_LONG).show();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private String formatFileSize(long bytes) {
        if (bytes < 1024) return bytes + " B";
        int exp = (int) (Math.log(bytes) / Math.log(1024));
        char pre = "KMGTPE".charAt(exp - 1);
        return String.format(Locale.CHINA, "%.1f %cB", bytes / Math.pow(1024, exp), pre);
    }

    private byte[] readFileToBytes(File file) throws Exception {
        FileInputStream fis = new FileInputStream(file);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int len;
        while ((len = fis.read(buf)) != -1) {
            bos.write(buf, 0, len);
        }
        bos.close();
        fis.close();
        return bos.toByteArray();
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
