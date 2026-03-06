CREATE TABLE IF NOT EXISTS app.blog_posts (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(200) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    markdown_content TEXT NOT NULL,
    html_content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    author_id BIGINT NOT NULL REFERENCES app.users(id),
    published_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON app.blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_date ON app.blog_posts(published_date DESC);

-- Seed existing blog post
INSERT INTO app.blog_posts (slug, title, summary, markdown_content, html_content, tags, author_id, published_date)
SELECT
    'my-first-post',
    'My First Post',
    'Welcome to my blog! Here I''ll share thoughts on software development, projects I''m working on, and things I find interesting.',
    E'# Welcome to My Blog\n\nI''ve been meaning to start writing about the things I build and learn, and I''m finally getting around to it.\n\n## What to Expect\n\nI plan to write about:\n\n- **Projects** I''m working on, like this website and the other things on my portfolio\n- **Software development** tips and patterns I find useful\n- **Problem solving** approaches that have helped me grow as a developer\n\n## Why a Blog?\n\nBuilding things is great, but explaining *how* and *why* you built them is just as valuable. Writing forces you to organize your thoughts, and hopefully someone else finds it useful along the way.\n\nStay tuned for more posts!',
    E'<h1>Welcome to My Blog</h1>\n<p>I''ve been meaning to start writing about the things I build and learn, and I''m finally getting around to it.</p>\n<h2>What to Expect</h2>\n<p>I plan to write about:</p>\n<ul>\n<li><strong>Projects</strong> I''m working on, like this website and the other things on my portfolio</li>\n<li><strong>Software development</strong> tips and patterns I find useful</li>\n<li><strong>Problem solving</strong> approaches that have helped me grow as a developer</li>\n</ul>\n<h2>Why a Blog?</h2>\n<p>Building things is great, but explaining <em>how</em> and <em>why</em> you built them is just as valuable. Writing forces you to organize your thoughts, and hopefully someone else finds it useful along the way.</p>\n<p>Stay tuned for more posts!</p>',
    ARRAY['dev', 'personal'],
    (SELECT id FROM app.users WHERE id = 1),
    '2026-03-06T00:00:00Z'
WHERE EXISTS (SELECT 1 FROM app.users WHERE id = 1)
AND NOT EXISTS (SELECT 1 FROM app.blog_posts WHERE slug = 'my-first-post');
