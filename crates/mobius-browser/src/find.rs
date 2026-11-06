//! Which match of a search is the current one. Engines that do not say reliably (or only count) lean on this.

/// `step` is 0 for a new search (the first match is current), 1 for next and -1 for previous; stepping wraps round.
/// With no matches nothing is current. `current` is the match shown before (1-based, 0 for none).
pub fn current_match(matches: u64, current: u64, step: i64) -> u64 {
    if matches == 0 {
        return 0;
    }
    if step == 0 || current == 0 {
        return if step < 0 { matches } else { 1 };
    }
    let count = i64::try_from(matches).unwrap_or(i64::MAX);
    let from = i64::try_from(current.min(matches)).unwrap_or(1);
    u64::try_from((from - 1 + step.signum()).rem_euclid(count) + 1).unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::current_match;

    #[test]
    fn a_new_search_starts_at_the_first_match_and_no_matches_means_none() {
        assert_eq!(current_match(3, 0, 0), 1);
        assert_eq!(current_match(3, 2, 0), 1, "a new search forgets where the last one was");
        assert_eq!(current_match(0, 0, 0), 0);
        assert_eq!(current_match(0, 4, 1), 0);
    }

    #[test]
    fn stepping_moves_one_along_and_wraps_round_both_ways() {
        assert_eq!(current_match(3, 1, 1), 2);
        assert_eq!(current_match(3, 3, 1), 1);
        assert_eq!(current_match(3, 1, -1), 3);
        assert_eq!(current_match(3, 2, -1), 1);
        assert_eq!(current_match(1, 1, 1), 1);
        assert_eq!(current_match(1, 1, -1), 1);
    }

    #[test]
    fn a_step_before_anything_is_current_starts_from_the_end_it_goes_towards() {
        assert_eq!(current_match(3, 0, 1), 1);
        assert_eq!(current_match(3, 0, -1), 3);
    }

    #[test]
    fn a_stale_position_beyond_the_new_count_is_pulled_back_and_big_steps_count_as_one() {
        assert_eq!(current_match(2, 9, 1), 1);
        assert_eq!(current_match(5, 2, 100), 3);
        assert_eq!(current_match(5, 2, -100), 1);
    }
}
