export const PUBLIC_MISSION_PARAGRAPHS = Object.freeze([
  "Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university. Through Vancouver Curiosity Club, we organize free, facilitated, in-person discussions and learning events involving literature, film, philosophy, ethics, psychology, history, culture and contemporary life.",
  "At a time when much of social life takes place through screens and public conversations can feel increasingly divided, our gatherings create space for genuine human connection, respectful disagreement and thoughtful reflection. Participants are encouraged to listen to different perspectives, examine their own assumptions and engage in good-faith discussion with people they might not otherwise meet.",
  "Our purpose is to strengthen curiosity, critical thinking, mutual understanding and meaningful community connection.",
] as const);

export const PUBLIC_MISSION_STATEMENT = PUBLIC_MISSION_PARAGRAPHS.join("\n\n");

const PUBLIC_MISSION_METADATA_DESCRIPTION =
  "Vancouver Curiosity and Education Society makes meaningful lifelong learning accessible after people leave school or university.";

export const PUBLIC_HOME_MISSION_COPY = Object.freeze({
  body: PUBLIC_MISSION_STATEMENT,
  eyebrow: "Our mission",
  heading: "Building community through curiosity.",
  metadataDescription: PUBLIC_MISSION_METADATA_DESCRIPTION,
  paragraphs: PUBLIC_MISSION_PARAGRAPHS,
});

export const PUBLIC_ABOUT_MISSION_COPY = Object.freeze({
  heading: "Our mission",
  introduction: PUBLIC_MISSION_STATEMENT,
  metadataDescription: PUBLIC_MISSION_METADATA_DESCRIPTION,
  paragraphs: PUBLIC_MISSION_PARAGRAPHS,
});
