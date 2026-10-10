import crypto from "crypto";

const EMAIL_BATCH_SIZE = 25;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const now = () => Date.now();

const page_number = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const page_limit = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? Math.min(number, MAX_LIMIT)
    : DEFAULT_LIMIT;
};

const escape_html = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const make_slug = (value = "") =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || crypto.randomUUID();

const valid_images = (images) =>
  Array.isArray(images) &&
  images.every(
    (image) => typeof image === "string" && /^https?:\/\/\S+$/i.test(image),
  );

const get_all_users = async (req) => {
  if (!process.env.USER_PROFILE_TYPE) {
    throw new Error("USER_PROFILE_TYPE is not configured");
  }

  const Profiles = await req.services("profiles");
  const users = [];
  const limit = 100;
  let page = 1;

  while (page <= 10000) {
    const result = await Profiles.call(
      `get_profiles?limit=${limit}&page=${page}`,
      {
        profile_type: process.env.USER_PROFILE_TYPE,
        filter: {},
      },
    );

    if (!result?.ok || !Array.isArray(result.data)) {
      throw new Error(result?.message || "Unable to retrieve user profiles");
    }

    users.push(...result.data);

    const pages = Number(result.pagination?.pages);

    if (Number.isFinite(pages) && pages > 0) {
      if (page >= pages) break;
    } else if (result.data.length < limit) {
      break;
    }

    page++;
  }

  return users;
};

const list_collection = async (collection, filter, page, limit, sort) => {
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    collection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
    collection.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

// POST /admin/blog/create
const create_blog = async (req) => {
  const {
    title,
    body,
    excerpt = "",
    images = [],
    slug: requested_slug,
  } = req.body || {};

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof body !== "string" ||
    !body.trim()
  ) {
    return {
      ok: false,
      status: 400,
      message: "title and body are required",
    };
  }

  if (typeof excerpt !== "string" || !valid_images(images)) {
    return {
      ok: false,
      status: 400,
      message:
        "excerpt must be a string and images must be an array of image URLs",
    };
  }

  const Blogs = await req.db.folder("Blogs");
  let slug = make_slug(requested_slug || title);

  if (await Blogs.findOne({ slug })) {
    slug = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  }

  const timestamp = now();

  const blog = {
    _id: crypto.randomUUID(),
    title: title.trim(),
    body: body.trim(),
    excerpt: excerpt.trim(),
    images,
    slug,
    status: "draft",
    // author_id: authorization.profile._id,
    created: timestamp,
    updated: timestamp,
    published_at: null,
    email_campaign_id: null,
    email_campaign_status: null,
  };

  await Blogs.insertOne(blog);

  return {
    ok: true,
    status: 201,
    message: "Blog post created as draft",
    data: blog,
  };
};

// POST /admin/blog/update
const update_blog = async (req) => {
  const {
    blog_id,
    title,
    body,
    excerpt,
    images,
    slug: requested_slug,
  } = req.body || {};

  if (!blog_id) {
    return { ok: false, status: 400, message: "blog_id is required" };
  }

  const Blogs = await req.db.folder("Blogs");
  const blog = await Blogs.findOne({ _id: blog_id });

  if (!blog) {
    return { ok: false, status: 404, message: "Blog post not found" };
  }

  const updates = {};

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return {
        ok: false,
        status: 400,
        message: "title must be a non-empty string",
      };
    }
    updates.title = title.trim();
  }

  if (body !== undefined) {
    if (typeof body !== "string" || !body.trim()) {
      return {
        ok: false,
        status: 400,
        message: "body must be a non-empty string",
      };
    }
    updates.body = body.trim();
  }

  if (excerpt !== undefined) {
    if (typeof excerpt !== "string") {
      return { ok: false, status: 400, message: "excerpt must be a string" };
    }
    updates.excerpt = excerpt.trim();
  }

  if (images !== undefined) {
    if (!valid_images(images)) {
      return {
        ok: false,
        status: 400,
        message: "images must be an array of valid HTTP(S) URLs",
      };
    }
    updates.images = images;
  }

  if (requested_slug !== undefined) {
    if (typeof requested_slug !== "string" || !requested_slug.trim()) {
      return {
        ok: false,
        status: 400,
        message: "slug must be a non-empty string",
      };
    }

    const slug = make_slug(requested_slug);
    const duplicate = await Blogs.findOne({ slug });

    if (duplicate && duplicate._id !== blog_id) {
      return { ok: false, status: 409, message: "Slug is already in use" };
    }

    updates.slug = slug;
  }

  if (!Object.keys(updates).length) {
    return {
      ok: false,
      status: 400,
      message: "Provide at least one field to update",
    };
  }

  updates.updated = now();

  await Blogs.updateOne({ _id: blog_id }, { $set: updates });

  return {
    ok: true,
    message: "Blog post updated",
    data: { ...blog, ...updates },
  };
};

const send_blog_announcement = async (req, blog, admin_id) => {
  const Campaigns = await req.db.folder("Email_campaigns");
  const Recipients = await req.db.folder("Email_campaign_Recipients");

  const campaign_id = crypto.randomUUID();
  const timestamp = now();

  const subject = `${blog.title}`;
  const blog_url = `https://rushboxapp.com/blog/${encodeURIComponent(blog.slug)}`;

  const text = [
    blog.title,
    blog.excerpt || "",
    blog.images?.length ? `Images:\n${blog.images.join("\n")}` : "",
    `Read the full article: ${blog_url}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const email_template = "blog-post";

  await Campaigns.insertOne({
    _id: campaign_id,
    type: "blog_announcement",
    related_blog_id: blog._id,
    subject,
    audience: "all_users",
    template: email_template,
    status: "processing",
    total_recipients: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    // created_by: admin_id,
    created: timestamp,
    updated: timestamp,
  });

  let users;

  try {
    users = await get_all_users(req);
  } catch (error) {
    await Campaigns.updateOne(
      { _id: campaign_id },
      {
        $set: {
          status: "failed",
          error: error.message,
          updated: now(),
          completed: now(),
        },
      },
    );

    return {
      ok: false,
      campaign_id,
      status: "failed",
      sent: 0,
      failed: 0,
      skipped: 0,
      total_recipients: 0,
      message: "Could not retrieve users for the announcement",
    };
  }

  const Aimail = await req.services("aimail");

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let offset = 0; offset < users.length; offset += EMAIL_BATCH_SIZE) {
    const batch = users.slice(offset, offset + EMAIL_BATCH_SIZE);

    for (const user of batch) {
      const recipient_id = crypto.randomUUID();

      const email =
        typeof user.email === "string" ? user.email.trim().toLowerCase() : "";

      const recipient = {
        _id: recipient_id,
        campaign_id,
        profile_id: user._id || null,
        email: email || null,
        status: "pending",
        error: null,
        created: now(),
        updated: now(),
      };

      await Recipients.insertOne(recipient);

      if (!email) {
        skipped++;

        await Recipients.updateOne(
          { _id: recipient_id },
          {
            $set: {
              status: "skipped",
              error: "User has no email address",
              updated: now(),
            },
          },
        );

        continue;
      }

      try {
        const result = await Aimail.call("send_mail", {
          to: email,
          from: "Rushbox Logistics",
          content: {
            template: email_template,
            params: {
              subject,
              title: blog.title,
              excerpt: blog.excerpt || "",
              images: blog.images || [],
              images_text: (blog.images || []).join("\n"),
              blog_url,
              text,
            },
          },
        });

        if (result?.ok) {
          sent++;

          await Recipients.updateOne(
            { _id: recipient_id },
            {
              $set: {
                status: "sent",
                response: result.message || null,
                updated: now(),
              },
            },
          );
        } else {
          failed++;

          await Recipients.updateOne(
            { _id: recipient_id },
            {
              $set: {
                status: "failed",
                error: result?.message || "Email service rejected the message",
                updated: now(),
              },
            },
          );
        }
      } catch (error) {
        failed++;

        await Recipients.updateOne(
          { _id: recipient_id },
          {
            $set: {
              status: "failed",
              error: error?.message || "Email delivery failed",
              updated: now(),
            },
          },
        );
      }
    }
  }

  const status = failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";

  await Campaigns.updateOne(
    { _id: campaign_id },
    {
      $set: {
        status,
        total_recipients: users.length,
        sent,
        failed,
        skipped,
        updated: now(),
        completed: now(),
      },
    },
  );

  return {
    ok: failed === 0,
    campaign_id,
    status,
    total_recipients: users.length,
    sent,
    failed,
    skipped,
  };
};

// POST /admin/blog/publish
const publish_blog = async (req) => {
  const { blog_id } = req.body || {};

  const Blogs = await req.db.folder("Blogs");
  const blog = await Blogs.findOne({ _id: blog_id });

  if (!blog) {
    return {
      ok: false,
      status: 404,
      message: "Blog post not found",
    };
  }

  if (blog.status === "published" && blog.email_campaign_status === "sent") {
    return {
      ok: true,
      message: "Blog post is already published and announced",
      data: blog,
    };
  }

  if (blog.email_campaign_status === "processing") {
    return {
      ok: false,
      status: 409,
      message: "An announcement campaign is already processing",
    };
  }

  const published_at = blog.published_at || now();

  await Blogs.updateOne(
    { _id: blog_id },
    {
      $set: {
        status: "published",
        published_at,
        updated: now(),
        email_campaign_status: "processing",
      },
    },
  );

  const announcement = await send_blog_announcement(
    req,
    { ...blog, published_at },
    // authorization.profile._id,
  );

  await Blogs.updateOne(
    { _id: blog_id },
    {
      $set: {
        email_campaign_id: announcement.campaign_id,
        email_campaign_status: announcement.status,
        updated: now(),
      },
    },
  );

  const updated = await Blogs.findOne({ _id: blog_id });

  return {
    ok: announcement.ok,
    status: announcement.ok ? 200 : 502,
    message: announcement.ok
      ? "Blog published and announcement emails sent"
      : "Blog published, but the announcement campaign was not fully successful",
    data: {
      blog: updated,
      email_campaign: announcement,
    },
  };
};

// POST /admin/blog/unpublish
const unpublish_blog = async (req) => {
  const { blog_id } = req.body || {};

  const Blogs = await req.db.folder("Blogs");
  const blog = await Blogs.findOne({ _id: blog_id });

  if (!blog) {
    return { ok: false, status: 404, message: "Blog post not found" };
  }

  await Blogs.updateOne(
    { _id: blog_id },
    {
      $set: {
        status: "draft",
        updated: now(),
      },
    },
  );

  return {
    ok: true,
    message: "Blog post unpublished",
    data: { ...blog, status: "draft", updated: now() },
  };
};

// POST /admin/blog/delete
const delete_blog = async (req) => {
  const { blog_id } = req.body || {};

  if (!blog_id) {
    return { ok: false, status: 400, message: "blog_id is required" };
  }

  const Blogs = await req.db.folder("Blogs");
  const result = await Blogs.deleteOne({ _id: blog_id });

  if (!result.deletedCount) {
    return { ok: false, status: 404, message: "Blog post not found" };
  }

  return {
    ok: true,
    message: "Blog post deleted",
    data: { blog_id },
  };
};

// GET /admin/blogs
const admin_blogs = async (req) => {
  const page = page_number(req.query?.page);
  const limit = page_limit(req.query?.limit);
  const filter = {};

  if (req.query?.status) {
    if (!["draft", "published"].includes(req.query.status)) {
      return {
        ok: false,
        status: 400,
        message: "status must be draft or published",
      };
    }
    filter.status = req.query.status;
  }

  const Blogs = await req.db.folder("Blogs");
  const result = await list_collection(Blogs, filter, page, limit, {
    created: -1,
  });

  return {
    ok: true,
    message: "Blog posts retrieved",
    ...result,
  };
};

// GET /blog
const blog_posts = async (req) => {
  const page = page_number(req.query?.page);
  const limit = page_limit(req.query?.limit);
  const Blogs = await req.db.folder("Blogs");

  const result = await list_collection(
    Blogs,
    { status: "published" },
    page,
    limit,
    { published_at: -1 },
  );

  return {
    ok: true,
    message: "Published blog posts retrieved",
    data: result.data.map((blog) => ({
      _id: blog._id,
      title: blog.title,
      excerpt: blog.excerpt || "",
      images: blog.images || [],
      slug: blog.slug,
      author_id: blog.author_id || null,
      created: blog.created,
      updated: blog.updated,
      published_at: blog.published_at,
    })),
    pagination: result.pagination,
  };
};

// POST /blog/post
const blog_post = async (req) => {
  const { blog_id, slug } = req.body || {};

  const Blogs = await req.db.folder("Blogs");
  const filter = { status: "published" };

  if (blog_id) filter._id = blog_id;
  else filter.slug = slug;

  const blog = await Blogs.findOne(filter);

  if (!blog) {
    return { ok: false, status: 404, message: "Blog post not found" };
  }

  return {
    ok: true,
    message: "Blog post retrieved",
    data: {
      _id: blog._id,
      title: blog.title,
      body: blog.body,
      excerpt: blog.excerpt || "",
      images: blog.images || [],
      slug: blog.slug,
      author_id: blog.author_id || null,
      created: blog.created,
      updated: blog.updated,
      published_at: blog.published_at,
    },
  };
};

// GET /admin/blog/campaigns
const admin_blog_campaigns = async (req) => {
  const page = page_number(req.query?.page);
  const limit = page_limit(req.query?.limit);
  const Campaigns = await req.db.folder("Email_campaigns");

  const result = await list_collection(
    Campaigns,
    { type: "blog_announcement" },
    page,
    limit,
    { created: -1 },
  );

  return {
    ok: true,
    message: "Blog announcement campaigns retrieved",
    data: result,
  };
};

export {
  create_blog,
  update_blog,
  publish_blog,
  unpublish_blog,
  delete_blog,
  admin_blogs,
  blog_posts,
  blog_post,
  admin_blog_campaigns,
};
