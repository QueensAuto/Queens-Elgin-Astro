
// Native fetch is global in Node 18+

async function testFetch() {
    try {
        const response = await fetch("https://queensmobiletires.com/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: `
          query GetAllCities {
            cities(first: 5) {
              nodes {
                slug
                title
              }
            }
          }
        `
            }),
        });

        if (!response.ok) {
            console.log('Response not ok:', response.status, response.statusText);
            const text = await response.text();
            console.log('Body:', text);
            return;
        }

        const json = await response.json();
        console.log(JSON.stringify(json, null, 2));
    } catch (error) {
        console.error("Fetch error:", error);
    }
}

testFetch();
