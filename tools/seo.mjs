/* 羊毛AIHUB · SEO 注入脚本
 * 给每个页面补上 canonical / Open Graph / Twitter Card / JSON-LD 结构化数据，
 * 并生成 sitemap.xml 与 robots.txt。页面 head 里已有 title/description/keywords，
 * 本脚本不覆盖它们，只做「补齐」，重复执行安全（有标记则跳过）。
 *
 * 用法：node tools/seo.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SITE = "https://chenking-maker.github.io/yangmao-aihub";
const BRAND = "羊毛AIHUB";
const OG_IMG = SITE + "/assets/og.png";
const MARK = "<!-- seo:auto -->";

/** 每页的 SEO 配置：路径 / 长尾词 / 页面类型 */
const PAGES = {
  "index.html": {
    loc: "/",
    kw: "薅羊毛,优惠券,隐藏优惠券,双11红包,超级红包口令,天猫优惠券,淘宝优惠券怎么领,凑单神器,好价榜,9.9包邮,AI找券,省钱APP,网购省钱",
    type: "website",
    priority: "1.0"
  },
  "chat.html": {
    loc: "/chat.html",
    kw: "AI找优惠券,淘宝隐藏优惠券怎么领,发链接转优惠券,优惠券查询,AI省钱助手,对话找券",
    type: "website",
    priority: "0.9"
  },
  "tipoff.html": {
    loc: "/tipoff.html",
    kw: "实时线报,淘宝线报,京东线报,百亿补贴线报,优惠券线报,飞猪旅行优惠,美妆线报",
    type: "website",
    priority: "0.9"
  },
  "daily.html": {
    loc: "/daily.html",
    kw: "省钱日报,每天省多少,网购省钱统计,优惠汇总,双11省钱,省钱记录,昨天省了多少",
    type: "website",
    priority: "0.7"
  },
  "collection.html": {
    loc: "/collection.html",
    kw: "双11红包会场,超级红包入口,美团外卖红包,美团闪购优惠,本地生活优惠,到店优惠券,红包天天领",
    type: "website",
    priority: "0.9"
  },
  "coutao.html": {
    loc: "/coutao.html",
    kw: "凑单工具,跨店满减怎么算,双11凑单技巧,满200减20,凑单计算器,凑单免运费",
    type: "website",
    priority: "0.8"
  },
  "xhd.html": {
    loc: "/xhd.html",
    kw: "消灭小红包,9.9包邮,小红包怎么花,低价好物,包邮商品,小红包专区",
    type: "website",
    priority: "0.8"
  },
  "coin.html": {
    loc: "/coin.html",
    kw: "淘金币互助,淘金币怎么获得,双11淘金币,淘金币兑换红包,淘金币瓜分",
    type: "website",
    priority: "0.7"
  },
  "about.html": {
    loc: "/about.html",
    kw: "羊毛AIHUB介绍,薅羊毛网站,免费省钱工具,AI薅羊毛,省钱作业君",
    type: "website",
    priority: "0.7"
  },
  "skill.html": {
    loc: "/skill.html",
    kw: "薅羊毛Skill,微信AI插件,WorkBuddy Skill,AI薅羊毛助手,微信里薅羊毛",
    type: "website",
    priority: "0.6"
  },
  "wechat.html": {
    loc: "/wechat.html",
    kw: "羊毛微信群,线报群,优惠券分享群,凑单互助群",
    type: "website",
    priority: "0.5"
  }
};

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTags(file, cfg, title, desc) {
  const url = SITE + (cfg.loc === "/" ? "/" : cfg.loc);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": SITE + "/#website",
        url: SITE + "/",
        name: BRAND,
        description: "搭上 AI 最智能的模型，让羊毛不再传统。对话找券、领红包、凑单、实时线报，全站免费。",
        inLanguage: "zh-CN"
      },
      {
        "@type": "WebPage",
        "@id": url + "#page",
        url: url,
        name: title,
        description: desc,
        isPartOf: { "@id": SITE + "/#website" },
        inLanguage: "zh-CN"
      },
      {
        "@type": "SoftwareApplication",
        name: BRAND,
        applicationCategory: "ShoppingApplication",
        operatingSystem: "Web",
        url: SITE + "/",
        description: "AI 找券 / 领红包 / 凑单 / 实时线报 一站式省钱工具",
        offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" }
      }
    ]
  };
  return [
    MARK,
    `<link rel="canonical" href="${url}">`,
    `<meta name="robots" content="index,follow,max-image-preview:large">`,
    `<meta name="theme-color" content="#d93832">`,
    `<meta name="author" content="省钱作业君">`,
    `<meta property="og:type" content="${cfg.type}">`,
    `<meta property="og:site_name" content="${BRAND}">`,
    `<meta property="og:locale" content="zh_CN">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${xmlEscape(title)}">`,
    `<meta property="og:description" content="${xmlEscape(desc)}">`,
    `<meta property="og:image" content="${OG_IMG}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${xmlEscape(title)}">`,
    `<meta name="twitter:description" content="${xmlEscape(desc)}">`,
    `<meta name="twitter:image" content="${OG_IMG}">`,
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ].join("\n");
}

const sitemap = [];
for (const [file, cfg] of Object.entries(PAGES)) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) { console.log("跳过（不存在）:", file); continue; }
  let html = fs.readFileSync(p, "utf8");
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1].trim();
  let desc = (html.match(/<meta name="description" content="([^"]*)"/) || [, ""])[1].trim();

  // keywords 补齐
  if (!/name="keywords"/.test(html)) {
    html = html.replace("</title>", `</title>\n<meta name="keywords" content="${cfg.kw}">`);
  } else if (!/name="keywords" content="[^"]{80,}"/.test(html)) {
    html = html.replace(/<meta name="keywords" content="[^"]*">/, `<meta name="keywords" content="${cfg.kw}">`);
  }

  // 去掉旧的自动块（可重复执行）
  html = html.replace(new RegExp("\\n?" + MARK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?</script>", "g"), "");

  const tags = buildTags(file, cfg, title || BRAND, desc || title);
  html = html.replace("</head>", tags + "\n</head>");
  fs.writeFileSync(p, html, "utf8");
  console.log("✓", file, "→", cfg.loc);

  sitemap.push({
    url: SITE + (cfg.loc === "/" ? "/" : cfg.loc),
    priority: cfg.priority
  });
}

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(root, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  sitemap.map(s =>
    `  <url>\n    <loc>${s.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${s.priority}</priority>\n  </url>`
  ).join("\n") + `\n</urlset>\n`, "utf8");

fs.writeFileSync(path.join(root, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`, "utf8");

console.log(`\n已生成 sitemap.xml（${sitemap.length} 条）与 robots.txt`);
