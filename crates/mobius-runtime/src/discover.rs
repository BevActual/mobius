//! Looking for models to run: search Hugging Face, look inside the promising repositories, and rank what fits.

use crate::fit::{Hardware, Recommendation, recommend};
use crate::hub::{HubClient, HubError, RepoSummary, Sort, candidates_from};

const SEED_LIST: u32 = 25;
const SEARCH_LIST: u32 = 30;
const MAX_REPOS: usize = 40;
const PARALLEL: usize = 8;

/// With a query, the matching repositories. Without one, what is trending and what is popular.
pub fn discover(client: &HubClient, query: &str, hardware: &Hardware, limit: usize) -> Result<Vec<Recommendation>, HubError> {
    let mut repos: Vec<RepoSummary> = Vec::new();
    let lists: Vec<(Sort, u32)> = if query.trim().is_empty() { vec![(Sort::Trending, SEED_LIST), (Sort::Downloads, SEED_LIST)] } else { vec![(Sort::Downloads, SEARCH_LIST)] };
    let mut first_error = None;
    for (sort, count) in lists {
        match client.search(query, sort, count) {
            Ok(found) => {
                for repo in found {
                    if repo.is_text_model() && !repo.gated && !repos.iter().any(|r| r.id == repo.id) {
                        repos.push(repo);
                    }
                }
            }
            Err(error) => first_error = first_error.or(Some(error)),
        }
    }
    if repos.is_empty() {
        return match first_error {
            Some(error) => Err(error),
            None => Ok(Vec::new()),
        };
    }
    repos.truncate(MAX_REPOS);

    let mut candidates = Vec::new();
    let mut failures = 0;
    for chunk in repos.chunks(PARALLEL) {
        let results: Vec<_> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk.iter().map(|repo| scope.spawn(move || (repo, client.files(&repo.id)))).collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        for (repo, files) in results {
            match files {
                Ok(files) => candidates.extend(candidates_from(repo, &files)),
                Err(_) => failures += 1,
            }
        }
    }
    if failures == repos.len() {
        return Err(HubError::Network("none of the repositories could be read".into()));
    }
    Ok(recommend(candidates, hardware, limit))
}
