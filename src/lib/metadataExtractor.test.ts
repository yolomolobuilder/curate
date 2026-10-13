import { describe, it, expect } from 'vitest';
import { detectTopic } from './metadataExtractor';

describe('detectTopic', () => {
  it('detects Marketing correctly', () => {
    expect(detectTopic('The ultimate guide to seo')).toBe('Marketing');
    expect(detectTopic('Google ads strategies')).toBe('Marketing');
    expect(detectTopic('Mastering copywriting')).toBe('Marketing');
  });

  it('detects UX/UI correctly', () => {
    expect(detectTopic('Best practices in UX')).toBe('UX/UI');
    expect(detectTopic('Learning figma basics')).toBe('UX/UI');
    expect(detectTopic('Modern typography')).toBe('UX/UI');
  });

  it('handles word boundaries correctly to prevent false positives', () => {
    // Should NOT be "UX/UI" because 'ux' is part of 'tuxedo'
    expect(detectTopic('How to wear a tuxedo')).toBe('Deep Dive');

    // Should NOT be "UX/UI" because 'ui' is part of 'building'
    expect(detectTopic('Building a house')).toBe('Deep Dive');

    // Should NOT be "Marketing" because 'ads' is part of 'threads'
    expect(detectTopic('Meta launches new app threads')).toBe('Deep Dive');

    // Should NOT be "Fitness" because 'run' is part of 'running' or 'brunch'
    // Actually, "running" shouldn't trigger "run", but let's test a more clear substring
    expect(detectTopic('Brunch in the city')).toBe('Deep Dive');
  });

  it('handles special characters next to keywords', () => {
    expect(detectTopic('Is SEO dead?')).toBe('Marketing');
    expect(detectTopic('Focus on UI/UX')).toBe('UX/UI');
    expect(detectTopic('Marketing, sales, and more')).toBe('Marketing');
  });

  it('handles multiple keywords by picking the first matching category (order dependent)', () => {
    // Both 'marketing' and 'design' (UX/UI) are present.
    // 'Marketing' is checked before 'UX/UI' in the code.
    expect(detectTopic('Marketing and design')).toBe('Marketing');
  });

  it('detects other categories correctly', () => {
    expect(detectTopic('Learn german fast')).toBe('German');
    expect(detectTopic('Advanced english grammar')).toBe('English');
    expect(detectTopic('Sleep and health')).toBe('Health');
    expect(detectTopic('Daily workout routine')).toBe('Fitness');
    expect(detectTopic('Cognitive bias explained')).toBe('Psychology');
    expect(detectTopic('Startup founder tips')).toBe('Business');
    expect(detectTopic('Global economy news')).toBe('Economics');
    expect(detectTopic('Ancient roman history')).toBe('History');
    expect(detectTopic('Quantum physics')).toBe('Science');
    expect(detectTopic('Stoic philosophy')).toBe('Philosophy');
    expect(detectTopic('Cinema and art')).toBe('Culture');
    expect(detectTopic('AI and software engineering')).toBe('Technology');
  });

  it('handles invalid inputs and empty strings gracefully', () => {
    expect(detectTopic('')).toBe('Deep Dive');
    expect(detectTopic('   ')).toBe('Deep Dive'); // It won't match any words
    expect(detectTopic(undefined as any)).toBe('Deep Dive');
    expect(detectTopic(null as any)).toBe('Deep Dive');
  });

  it('handles multi-line strings', () => {
    expect(detectTopic('Line 1\nLine 2 has seo\nLine 3')).toBe('Marketing');
  });
});
