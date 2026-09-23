require("dotenv").config();

const { Client } = require("@notionhq/client");

const NOTION_TOKEN = process.env.B_TOKEN;
const DATABASE_ID = process.env.B_DATABASE_ID;

if (!NOTION_TOKEN || !DATABASE_ID) {
  console.error('missing env vars: B_TOKEN / B_DATABASE_ID (check .env)');
  process.exit(1);
}


async function main() {
  // new Client({ auth })：创建一个 Notion 客户端
  const notion = new Client({ auth: NOTION_TOKEN });

  // v5 的做法：先 retrieve 数据库，拿到 data_source_id
  const db = await notion.databases.retrieve({ database_id: DATABASE_ID });

  // ?. 是“可选链”语法：前面为空/不存在就返回 undefined，不会报错
  const dsId = db?.data_sources?.[0]?.id;

  if (!dsId) {
    // JSON.stringify(..., null, 2) 用来把对象漂亮打印出来
    console.log("数据库返回内容：", JSON.stringify(db, null, 2));
    throw new Error("没有找到 data_sources[0].id（可能 DATABASE_ID 填错，或未授权）");
  }

  // 用 dataSources.query 查询（等价于旧版 databases.query）
  const res = await notion.dataSources.query({
    data_source_id: dsId,
    page_size: 3,
  });

  console.log("✅ 成功访问数据库并查询到数据源！");
  console.log("取样返回条目数:", res.results?.length ?? 0);
  if (res.results?.[0]) console.log("第一条记录 page id:", res.results[0].id);
}

main().catch((err) => {
  console.error("❌ 失败：");
  console.error(err?.body || err);
  process.exit(1);
});