export interface PollOptionVotes {
  id: string;
  label: string;
  votes: number;
}

export interface PollOptionStats extends PollOptionVotes {
  percentage: number;
  isLeading: boolean;
}

function normalizeVotes(votes: number): number {
  if (!Number.isFinite(votes) || votes < 0) {
    return 0;
  }
  return votes;
}

export function buildPollOptionStats(
  options: PollOptionVotes[],
): PollOptionStats[] {
  const normalizedOptions = options.map((option) => ({
    ...option,
    votes: normalizeVotes(option.votes),
  }));
  const totalVotes = normalizedOptions.reduce(
    (sum, option) => sum + option.votes,
    0,
  );
  const maxVotes = normalizedOptions.reduce(
    (max, option) => Math.max(max, option.votes),
    0,
  );

  return normalizedOptions.map((option) => ({
    ...option,
    percentage:
      totalVotes <= 0
        ? 0
        : Number(((option.votes / totalVotes) * 100).toFixed(1)),
    isLeading: maxVotes > 0 && option.votes === maxVotes,
  }));
}
