import { getPosts } from "../../lib/posts.ts";
import { formatDate } from "../../lib/utils.ts";

export default async function Archive(): Promise<JSX.Element> {
  const posts = await getPosts();

  const postsByYear = posts.reduce<Record<number, typeof posts>>((acc, post) => {
    const year = new Date(post.date).getFullYear();
    (acc[year] ??= []).push(post);
    return acc;
  }, {});

  const years = Object.keys(postsByYear)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div>
      <h1 className="text-4xl font-bold mb-8">Archive</h1>
      {years.map((year) => (
        <div key={year} className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">{year}</h2>
          <ul className="space-y-2">
            {postsByYear[year]?.map((post) => (
              <li key={post.slug}>
                <a
                  href={`/blog/${post.slug}`}
                  className="text-blue-600 hover:underline"
                >
                  {post.title}
                </a>
                <span className="text-gray-600 ml-2">
                  {formatDate(post.date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
