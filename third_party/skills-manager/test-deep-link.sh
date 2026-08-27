#!/bin/bash

# Deep Link 测试脚本
# 用于测试 Skills Manager 的 Deep Link 唤起

echo "🔍 测试 Deep Link 功能"
echo ""

# 测试 URL
TEST_URL="skills-manager://auth/callback?login_code=test123&state=test-state"

echo "📋 测试 URL: $TEST_URL"
echo ""

# macOS 使用 open 命令
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 检测到 macOS，使用 'open' 命令测试"
    echo ""
    echo "1️⃣ 首先检查 URL scheme 是否已注册..."

    # 检查是否有 Skills Manager 应用
    APP_PATH=$(mdfind "kMDItemCFBundleIdentifier == 'com.yjw.skills-manager'" 2>/dev/null | head -1)

    if [ -n "$APP_PATH" ]; then
        echo "✅ 找到 Skills Manager 应用: $APP_PATH"

        # 获取 app 的 Info.plist
        PLIST="$APP_PATH/Contents/Info.plist"
        if [ -f "$PLIST" ]; then
            echo "✅ Info.plist 存在"

            # 检查 URL scheme
            if /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1; then
                echo "✅ URL scheme 已配置"
                /usr/libexec/PlistBuddy -c "Print :CFBundleURLTypes" "$PLIST"
            else
                echo "❌ URL scheme 未配置"
            fi
        fi
    else
        echo "⚠️  未找到已安装的 Skills Manager 应用"
        echo "   开发模式下，需要先运行 'npm run tauri dev' 或 'npm run tauri build'"
    fi

    echo ""
    echo "2️⃣ 尝试打开 Deep Link..."
    open "$TEST_URL"

    if [ $? -eq 0 ]; then
        echo "✅ open 命令执行成功"
        echo "   如果应用没有打开，说明 URL scheme 未注册或应用未运行"
    else
        echo "❌ open 命令失败"
    fi

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🐧 检测到 Linux，使用 'xdg-open' 命令测试"
    xdg-open "$TEST_URL"

elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    echo "🪟 检测到 Windows，使用 'start' 命令测试"
    start "$TEST_URL"

else
    echo "❌ 未识别的操作系统: $OSTYPE"
    exit 1
fi

echo ""
echo "✨ 测试完成"
echo ""
echo "🔧 调试提示："
echo "1. 确保应用正在运行 (npm run tauri dev)"
echo "2. 检查控制台是否有 Deep Link 相关日志"
echo "3. 开发模式下，可能需要先构建一次应用才能注册 URL scheme"
echo "4. 如果应用没有打开，尝试运行: npm run tauri build"
