const { Client } = require("@notionhq/client");

// ===== Notion 配置 =====
require("dotenv").config();

const A_TOKEN = process.env.A_TOKEN;
const A_DATABASE_ID = process.env.A_DATABASE_ID;

const B_TOKEN = process.env.B_TOKEN;
const B_DATABASE_ID = process.env.B_DATABASE_ID;

// 唯一匹配键
const SYNC_ID_PROP = "Sync ID";

// false = 不归档 B 中多出来的记录
const ARCHIVE_MISSING_IN_A = true;

const MIN_A_RECORDS_FOR_ARCHIVE = 5;



// =====================================================
// 从普通文字属性中读取文字
// =====================================================
function getTextFromProperty(prop) {
  if (!prop) return "";

  if (prop.type === "title") {
    return (prop.title || [])
      .map(t => t.plain_text)
      .join("");
  }

  if (prop.type === "rich_text") {
    return (prop.rich_text || [])
      .map(t => t.plain_text)
      .join("");
  }

  return "";
}


// =====================================================
// 读取 Sync ID
// 兼容：unique_id / rich_text / title
// =====================================================
function extractSyncId(page) {
  const prop = page.properties?.[SYNC_ID_PROP];

  if (!prop) return null;

  // Notion Unique ID
  if (prop.type === "unique_id") {
    const number = prop.unique_id?.number;

    if (number === null || number === undefined) {
      return null;
    }

    return Number(number);
  }

  // 普通文本
  if (prop.type === "rich_text") {
    const value = getTextFromProperty(prop).trim();
    return value || null;
  }

  // 标题
  if (prop.type === "title") {
    const value = getTextFromProperty(prop).trim();
    return value || null;
  }

  return null;
}


// =====================================================
// 获取 Data Source ID
// =====================================================
async function getDataSourceId(notion, databaseId) {
  const db = await notion.databases.retrieve({
    database_id: databaseId
  });

  const dsId = db?.data_sources?.[0]?.id;

  if (!dsId) {
    throw new Error(
      `数据库 ${databaseId} 没找到 data_sources[0].id`
    );
  }

  return dsId;
}


// =====================================================
// 获取 Data Source 全部记录
// =====================================================
async function queryAllPagesInDataSource(notion, dataSourceId) {
  let all = [];
  let cursor = undefined;

  while (true) {
    const params = {
      data_source_id: dataSourceId,
      page_size: 100
    };

    if (cursor) {
      params.start_cursor = cursor;
    }

    const res = await notion.dataSources.query(params);

    all = all.concat(res.results || []);

    if (!res.has_more) {
      break;
    }

    cursor = res.next_cursor;
  }

  return all;
}


// =====================================================
// 在 B 中寻找相同 Sync ID
// =====================================================
async function findBPageBySyncId(notionB, bDataSourceId, syncId) {

  // B 数据库里的 Sync ID 是普通文本字段
  // 所以无论 A 是 Unique ID 还是文本，
  // 都统一转换成字符串后去 B 里查找

  const syncIdText = `SN-${syncId}`;

  const res = await notionB.dataSources.query({
    data_source_id: bDataSourceId,
    page_size: 2,
    filter: {
      property: SYNC_ID_PROP,
      rich_text: {
        equals: syncIdText
      }
    }
  });

  return res.results?.[0] || null;
}

// =====================================================
// 构造同步属性
// 注意：Unique ID 是 Notion 自动生成的，不能直接写入
// =====================================================
// =====================================================
// 构造同步属性
// 注意：Unique ID 是 Notion 自动生成的，不能直接写入
// =====================================================
function buildUpsertPropertiesFromA(aPage) {

  const properties = {};

  for (const [name, property] of Object.entries(aPage.properties || {})) {

    // =================================================
    // Sync ID
    // A 是 Unique ID
    // B 是普通文本
    // 所以把 A 的数字转换成文本写入 B
    // =================================================
    if (name === SYNC_ID_PROP) {

      if (
        property.type === "unique_id" &&
        property.unique_id?.number !== null &&
        property.unique_id?.number !== undefined
      ) {

        properties[name] = {
          rich_text: [
            {
              type: "text",
              text: {
                content: `${property.unique_id.prefix}-${property.unique_id.number}`
              }
            }
          ]
        };
      }

      continue;
    }


    // =================================================
    // Select
    // A → B
    // 不直接复制 option 的 id / color
    // 只使用 option 的 name
    // =================================================
    if (property.type === "select") {

      if (property.select === null) {

        properties[name] = {
          select: null
        };

      } else {

        properties[name] = {
          select: {
            name: property.select.name
          }
        };
      }

      continue;
    }


    // =================================================
    // Multi Select
    // A → B
    // 不直接复制 option 的 id / color
    // 只使用 option 的 name
    // =================================================
    if (property.type === "multi_select") {

      properties[name] = {
        multi_select: (property.multi_select || []).map(
          option => ({
            name: option.name
          })
        )
      };

      continue;
    }


    // =================================================
    // 其他字段直接同步
    // =================================================
    properties[name] = property;
  }

  return properties;
}
// =====================================================
// 主程序
// =====================================================
async function main() {
  console.time("同步总耗时");

  const notionA = new Client({
    auth: A_TOKEN
  });

  const notionB = new Client({
    auth: B_TOKEN
  });


  // 1. 获取 Data Source ID
  const aDsId = await getDataSourceId(
    notionA,
    A_DATABASE_ID
  );

  const bDsId = await getDataSourceId(
    notionB,
    B_DATABASE_ID
  );


  // 2. 获取 A 全部记录
  const aPages = await queryAllPagesInDataSource(
    notionA,
    aDsId
  );

  console.log(`Seotter 端记录数: ${aPages.length}`);


  // 3. 输出开始提示
  if (aPages.length > 0) {

    console.log("===== 开始同步 =====");

   
    console.log("================================");
  }


  // 4. 开始同步
  const aSyncIdSet = new Set();

  let created = 0;
  let updated = 0;
  let skippedNoSyncId = 0;


  for (const aPage of aPages) {

    const syncId = extractSyncId(aPage);


    if (syncId === null) {

      skippedNoSyncId++;

      continue;
    }


    aSyncIdSet.add(String(syncId));


    // 在 B 中寻找相同 Sync ID
    const bPage = await findBPageBySyncId(
      notionB,
      bDsId,
      syncId
    );

    // 构造需要同步的属性
    const properties = buildUpsertPropertiesFromA(
      aPage
    );


    // B 中不存在 → 创建
    if (!bPage) {

      await notionB.pages.create({
        parent: {
          data_source_id: bDsId
        },
        properties
      });

      created++;

    }

    // B 中已经存在 → 更新
    else {

      await notionB.pages.update({
        page_id: bPage.id,
        properties
      });

      updated++;
    }


    // 每处理 10 条显示一次进度
    if (
      (created + updated) % 10 === 0
    ) {

      console.log(
        `当前进度：${created + updated}/${aPages.length}`
      );
    }
  }


  console.log("");
  console.log("===== 同步完成 =====");

  console.log(
    `created=${created}, updated=${updated}, skippedNoSyncId=${skippedNoSyncId}`
  );


  // ===================================================
  // 可选：归档 B 中 A 没有的记录
  // ===================================================
// ===================================================
// 可选：归档 B 中 A 没有的记录
// ===================================================

if (
  ARCHIVE_MISSING_IN_A &&
  aPages.length >= MIN_A_RECORDS_FOR_ARCHIVE
) {

  const bPages = await queryAllPagesInDataSource(
    notionB,
    bDsId
  );

  let archived = 0;


  for (const bPage of bPages) {

    const syncId =
      extractSyncId(bPage);


    if (syncId === null) {
      continue;
    }


    if (
      !aSyncIdSet.has(
        String(syncId).replace(/^SN-/, "")
      )
    ) {

      await notionB.pages.update({
        page_id: bPage.id,
        archived: true
      });

      archived++;
    }
  }


  console.log(
    `已归档 Synova 端多余记录：${archived}`
  );

} else if (ARCHIVE_MISSING_IN_A) {

  console.log(
    `A端记录数 ${aPages.length} 小于保护阈值 ${MIN_A_RECORDS_FOR_ARCHIVE}，跳过归档`
  );

}
console.timeEnd("同步总耗时");
}
  


// =====================================================
// 错误处理
// =====================================================
main().catch((err) => {

  console.error("❌ 同步失败：");

  console.error(
    err?.body || err
  );

  process.exit(1);
});