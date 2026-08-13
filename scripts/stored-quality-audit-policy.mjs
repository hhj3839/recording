const commentForbiddenExpressions = ["부족함", "미흡함", "못함", "어려워함", "이해하지 못함", "소극적임", "불성실함"];
const behaviorForbiddenTerms = ["수상", "대회 실적", "사교육", "학원", "공인시험", "부모 직업", "가정형편", "사회경제적"];
const unsupportedConcepts = [
  { label: "자신 있게", pattern: /자신(?:감)?있|자신감을?(?:가지|보이)/ },
  { label: "적극적으로", pattern: /적극적/ },
  { label: "자기주도적으로", pattern: /자기주도적/ },
  { label: "모둠원과 협력", pattern: /모둠(?:원)?.{0,4}(?:협력|협동)/ },
  { label: "친구와 협력", pattern: /친구.{0,4}(?:협력|협동)/ },
  { label: "끝까지", pattern: /(?:끝|마지막)까지/ },
  { label: "성실하게", pattern: /성실/ },
  { label: "꾸준히 참여", pattern: /(?:꾸준|지속적).{0,4}참여/ },
  { label: "의미를 파악", pattern: /의미(?:를)?(?:파악|이해)/ },
  { label: "스스로", pattern: /(?:스스로|자발적)/ },
  { label: "주도적으로", pattern: /주도적/, exclude: /자기주도적/ },
  { label: "능동적으로", pattern: /능동적/ },
  { label: "논리적으로", pattern: /논리적/ },
  { label: "효과적으로", pattern: /효과적/ },
  { label: "원활하게", pattern: /원활/ },
];
const spellingRules = [
  /[^\S\r\n]{2,}/, /\s+[,.!?]/, /[.!?]{2,}/, /되여/, /돼어/, /않됨/, /않함/,
  /(할|될|볼|알|쓸|갈|올)수(?=[가-힣\s,.!?]|$)/, /몇일/, /역활/, /어떻해/, /금새/,
  /웬지/, /깨끗히/, /곰곰히/, /일일히/, /틈틈히/, /할려고/, /바램/, /[가-힣]데로/,
];

const percent = (count, total) => total ? Math.round(count / total * 10000) / 100 : 0;
const normalizeGroundingText = (text) => String(text || "").normalize("NFKC").replace(/[\s·ㆍ,，.。!?！？:：;'"“”‘’()[\]{}]/g, "");
const sentencesOf = (text) => String(text || "").trim().split(/(?<=\.)\s+/).map((item) => item.trim()).filter(Boolean);

export function groundingWarnings(sentence, evidence) {
  const normalizedSentence = normalizeGroundingText(sentence);
  const normalizedEvidence = normalizeGroundingText(evidence);
  return unsupportedConcepts
    .filter(({ pattern, exclude }) => pattern.test(normalizedSentence) && !exclude?.test(normalizedSentence) && !pattern.test(normalizedEvidence))
    .map(({ label }) => label);
}

export function validateStoredComment(comment, expectedSentenceCount) {
  const sentences = sentencesOf(comment);
  const lengths = sentences.map((sentence) => Array.from(sentence).length);
  const awkwardEndings = sentences.filter((sentence) => /(?:고|며|아|어|감|함)\s*함\.$/.test(sentence));
  const forbidden = commentForbiddenExpressions.filter((term) => String(comment).includes(term));
  const checks = {
    sentenceCount: expectedSentenceCount > 0 && sentences.length === expectedSentenceCount,
    lengths: lengths.length > 0 && lengths.every((length) => length >= 50 && length <= 60),
    endings: sentences.length > 0 && sentences.every((sentence) => sentence.endsWith("함.")),
    naturalEndings: awkwardEndings.length === 0,
    forbidden: forbidden.length === 0,
  };
  return {
    strict: Object.values(checks).every(Boolean), checks,
    sentences, lengths, awkwardEndings, forbidden,
  };
}

function hasNominalMieumEnding(sentence) {
  const last = sentence.trim().replace(/[.!?]+$/, "").at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 16;
}

export function validateStoredBehavior(text) {
  const normalized = String(text || "").trim();
  const bytes = new TextEncoder().encode(normalized).length;
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
  const forbidden = behaviorForbiddenTerms.filter((term) => normalized.includes(term));
  const normalizedSentences = sentences.map((sentence) => sentence.replace(/[.!?\s]/g, ""));
  const repeated = normalizedSentences.filter((sentence, index) => normalizedSentences.indexOf(sentence) !== index);
  const spellingIssueCount = spellingRules.filter((pattern) => pattern.test(normalized)).length
    + (normalized.match(/\(/g)?.length === normalized.match(/\)/g)?.length ? 0 : 1);
  const checks = {
    length: bytes >= 500 && bytes <= 600,
    endings: sentences.length > 0 && sentences.every(hasNominalMieumEnding),
    forbidden: forbidden.length === 0,
    repeated: repeated.length === 0,
    growth: /(성장|변화|발전|향상|노력|기르|익히|꾸준|가능성|나아)/.test(normalized),
    spelling: spellingIssueCount === 0,
  };
  return { bytes, checks, strict: Object.values(checks).every(Boolean), forbidden, repeated, spellingIssueCount };
}

export function auditStoredResults({ students, plan, levels, comments, parts, behaviors }) {
  const subjects = [...new Set(plan.map((item) => item.subject))];
  const expectedCommentKeys = subjects.flatMap((subject) => students.map((student) => `${student.id}|${subject}`));
  const commentsByKey = new Map(comments.filter((item) => item.comment?.trim()).map((item) => [`${item.studentId}|${item.subject}`, item]));
  const levelsByKey = new Map(levels.map((item) => [`${item.studentId}|${item.subject}|${item.assessmentIndex}`, item.level]));
  const commentDetails = expectedCommentKeys.map((key) => {
    const [studentIdText, subject] = key.split("|");
    const studentId = Number(studentIdText);
    const subjectPlan = plan.filter((item) => item.subject === subject);
    const stored = commentsByKey.get(key);
    if (!stored) return { studentId, subject, missing: true, strict: false, groundingWarnings: [] };
    const validation = validateStoredComment(stored.comment, subjectPlan.length);
    const warnings = validation.sentences.flatMap((sentence, index) => {
      const level = levelsByKey.get(`${studentId}|${subject}|${index}`);
      const item = subjectPlan[index];
      const evidence = level === "상" ? item?.high : level === "중" ? item?.middle : level === "하" ? item?.low : "";
      return groundingWarnings(sentence, evidence).map((label) => ({ assessmentIndex: index, label }));
    });
    return { studentId, subject, missing: false, strict: validation.strict, checks: validation.checks, expectedSentences: subjectPlan.length, actualSentences: validation.sentences.length, lengths: validation.lengths, groundingWarnings: warnings };
  });
  const behaviorByStudent = new Map(behaviors.filter((item) => item.behavior?.trim()).map((item) => [Number(item.studentId), item]));
  const behaviorDetails = students.map((student) => {
    const stored = behaviorByStudent.get(Number(student.id));
    return stored ? { studentId: student.id, missing: false, ...validateStoredBehavior(stored.behavior) }
      : { studentId: student.id, missing: true, strict: false };
  });
  const savedComments = commentDetails.filter((item) => !item.missing).length;
  const strictComments = commentDetails.filter((item) => item.strict).length;
  const groundedComments = commentDetails.filter((item) => !item.missing && item.groundingWarnings.length === 0).length;
  const savedBehaviors = behaviorDetails.filter((item) => !item.missing).length;
  const strictBehaviors = behaviorDetails.filter((item) => item.strict).length;
  const commentFailureCounts = Object.fromEntries(["sentenceCount", "lengths", "endings", "naturalEndings", "forbidden"]
    .map((check) => [check, commentDetails.filter((item) => !item.missing && item.checks?.[check] === false).length]));
  const commentsBySubject = Object.fromEntries(subjects.map((subject) => {
    const subjectRows = commentDetails.filter((item) => item.subject === subject);
    const subjectStrict = subjectRows.filter((item) => item.strict).length;
    return [subject, { saved: subjectRows.filter((item) => !item.missing).length, strict: subjectStrict, strictRate: percent(subjectStrict, subjectRows.length) }];
  }));
  const commentClassification = commentDetails.map((item) => {
    const formatReasons = [];
    if (item.missing) formatReasons.push("missing");
    if (item.checks?.naturalEndings === false) formatReasons.push("awkwardNominalEnding");
    if (item.checks?.sentenceCount === false) formatReasons.push("sentenceCount");
    if (item.checks?.lengths === false) formatReasons.push("sentenceLength");
    if (item.checks?.endings === false) formatReasons.push("ending");
    if (item.checks?.forbidden === false) formatReasons.push("forbiddenExpression");
    return {
      studentId: item.studentId, subject: item.subject, formatReasons,
      meaningReview: item.groundingWarnings.length > 0,
      groundingWarnings: item.groundingWarnings,
    };
  });
  const formatCandidates = commentClassification.filter((item) => item.formatReasons.length > 0);
  const meaningCandidates = commentClassification.filter((item) => item.meaningReview);
  return {
    scope: { students: students.length, subjects: subjects.length, expectedComments: expectedCommentKeys.length, expectedBehaviors: students.length },
    comments: {
      saved: savedComments, missing: expectedCommentKeys.length - savedComments,
      strict: strictComments, strictRate: percent(strictComments, expectedCommentKeys.length),
      failureCounts: commentFailureCounts, bySubject: commentsBySubject,
      noGroundingWarning: groundedComments, noGroundingWarningRate: percent(groundedComments, savedComments),
      meaningTarget95Verified: false, unsupportedFactTarget3Verified: false,
      reviewNote: "근거 밖 태도·과정 표현 휴리스틱은 전수 검사했으나 의미 일치도와 미입력 사실 비율의 공식 판정에는 교사 검토가 필요함.",
      issues: commentDetails.filter((item) => item.missing || !item.strict || item.groundingWarnings.length).slice(0, 50),
      remediation: {
        readOnly: true, automaticChangesAllowed: false,
        formatCandidateCount: formatCandidates.length,
        meaningReviewCandidateCount: meaningCandidates.length,
        reasonCounts: Object.fromEntries(["missing", "awkwardNominalEnding", "sentenceCount", "sentenceLength", "ending", "forbiddenExpression"]
          .map((reason) => [reason, formatCandidates.filter((item) => item.formatReasons.includes(reason)).length])),
        formatCandidates,
        meaningReviewCandidates: meaningCandidates,
      },
    },
    behaviors: {
      saved: savedBehaviors, missing: students.length - savedBehaviors,
      strict: strictBehaviors, strictRate: percent(strictBehaviors, students.length), target95Met: percent(strictBehaviors, students.length) >= 95,
      issues: behaviorDetails.filter((item) => item.missing || !item.strict),
    },
    storedParts: { count: parts.length },
  };
}
