const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const UPTIME_BASE_URL = 'https://uptime.bestweb.com.my';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwiaCI6IjZlOGUxMjEzNDg5MmJhMDRiNTk2ZjA5ZjAzM2I0NDFlIiwiaWF0IjoxNzgzOTE2NjIzfQ.BlA_MSPQWNDRDcMduBNPWT2UqkjLR_8Ej-JBk1N5_cE';

// 适配 Render 动态分配的端口
const PORT = process.env.PORT || 3001;

// 增加健康检查，方便 Render 检测服务存活
app.get('/', (req, res) => res.send('Uptime Capture Service is Running!'));
app.get('/health', (req, res) => res.send('OK'));

app.post('/capture', async (req, res) => {
  const { uptime, dashboardId } = req.body;
  const targetId = (uptime || dashboardId || '').toString().trim();

  if (!targetId) {
    return res.status(400).json({ error: 'Missing uptime or dashboardId' });
  }

  console.log(`[${new Date().toLocaleTimeString()}] 收到精准红框截图任务: ID ${targetId}`);
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });

    // 1. 浅色模式
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // 2. 注入 Token 与 Light 样式
    await page.goto(UPTIME_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((token) => {
      localStorage.setItem('token', token);
      localStorage.setItem('jwtToken', token);
      localStorage.setItem('theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('dark');
      document.body.classList.add('light');
    }, JWT_TOKEN);

    // 3. 打开目标页面
    const targetUrl = `${UPTIME_BASE_URL}/dashboard/${targetId}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 4. 等待折线图加载完毕
    try {
      await page.waitForSelector('canvas', { timeout: 10000 });
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 4000));

    // 5. 隐藏左侧列表、顶部栏、操作按钮及下方事件列表
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.style.backgroundColor = '#ffffff';

      // 隐藏干扰元素
      const hideSelectors = [
        'header', 
        'nav', 
        '.navbar', 
        '.sidebar', 
        'aside', 
        '.bottom-nav',
        '.functions', // 操作按钮 (Pause, Edit, Clone, Delete)
        'div:has(> table)', // 下方事件表格
        'table',
        '.my-4' // 表格包裹层
      ];

      hideSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
        } catch (err) {}
      });
    });

    // 6. 计算红框范围：从标题顶部到折线图卡片底部
    const clipRegion = await page.evaluate(() => {
      const titleEl = document.querySelector('h1, h2, div.title, .monitor-title') || document.querySelector('main, .main');
      const canvasEl = document.querySelector('canvas') || document.querySelector('.shadow-box:last-of-type');

      if (!titleEl || !canvasEl) return null;

      const titleRect = titleEl.getBoundingClientRect();
      const chartBox = canvasEl.closest('.shadow-box') || canvasEl;
      const chartRect = chartBox.getBoundingClientRect();

      const padding = 15;
      const x = Math.max(0, titleRect.left - padding);
      const y = Math.max(0, titleRect.top - padding);
      const width = Math.max(chartRect.right, titleRect.right) - x + padding;
      const height = chartRect.bottom - y + padding;

      return {
        x: x,
        y: y,
        width: width,
        height: height
      };
    });

    let imageBuffer;
    if (clipRegion && clipRegion.width > 100 && clipRegion.height > 100) {
      imageBuffer = await page.screenshot({
        type: 'png',
        clip: clipRegion
      });
    } else {
      // 容错截图
      const fallbackBox = await page.$('.shadow-box');
      imageBuffer = fallbackBox ? await fallbackBox.screenshot({ type: 'png' }) : await page.screenshot({ type: 'png' });
    }

    console.log(`✅ 红框专属区域裁剪完成: ID ${targetId}`);
    res.set('Content-Type', 'image/png');
    res.send(imageBuffer);

  } catch (error) {
    console.error(`❌ 截图失败 (ID: ${targetId}):`, error.message);
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {}
    }
  }
});

// 监听 0.0.0.0 允许云端外部访问
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Uptime 红框专属区域截图服务已启动，监听端口: ${PORT}`);
});
