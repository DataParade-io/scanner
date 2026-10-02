declare module "vader-sentiment" {
  export interface VaderPolarityScores {
    neg: number;
    neu: number;
    pos: number;
    compound: number;
  }
  export const SentimentIntensityAnalyzer: {
    polarity_scores(sentence: string): VaderPolarityScores;
  };
}