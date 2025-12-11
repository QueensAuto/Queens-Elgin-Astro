const response = await fetch("https://queensmobiletires.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        query: `
      query GetAllCities {
        cities(first: 100) {
          nodes {
            slug
            title
          }
        }
      }
    `
    }),
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
