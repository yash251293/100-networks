import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getAuthUserFromRequest } from '@/lib/auth_utils';
import { UpdateProfileSchema, formatZodError } from '@/lib/validation_schemas';

// GET handler to retrieve the profile for the authenticated user
export async function GET(request: Request) {
  try {
    const authUser = getAuthUserFromRequest(request);
    if (!authUser || !authUser.userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const userId = authUser.userId;

    // Fetch user profile data along with basic user info
    // Adjust the query to join with user_profiles and potentially other related tables (skills, experiences, educations)
    const profileQuery = `
      SELECT
        u.id AS user_id,
        u.email,
        u.first_name,
        u.last_name,
        up.headline,
        up.bio,
        up.avatar_url,
        up.cover_photo_url,
        up.location,
        up.phone_number,
        up.website_url,
        up.linkedin_url,
        up.github_url
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE u.id = $1;
    `;

    const result = await pool.query(profileQuery, [userId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User profile not found.' }, // Or user not found
        { status: 404 }
      );
    }

    const userProfileData = result.rows[0];

    // TODO: Fetch related data like skills, experiences, education if needed
    // Example for skills (if you have user_skills and skills tables):
    // const skillsResult = await pool.query(
    //   'SELECT s.name FROM skills s JOIN user_skills us ON s.id = us.skill_id WHERE us.user_id = $1',
    //   [userId]
    // );
    // userProfileData.skills = skillsResult.rows.map(r => r.name);

    return NextResponse.json({ success: true, data: userProfileData }, { status: 200 });

  } catch (error) {
    console.error('Get Profile API Error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while fetching the profile.' },
      { status: 500 }
    );
  }
}


// PUT handler to update the profile for the authenticated user
export async function PUT(request: Request) {
  try {
    const authUser = getAuthUserFromRequest(request);
    if (!authUser || !authUser.userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const userId = authUser.userId;
    const body = await request.json();

    // --- Input Validation with Zod ---
    const validationResult = UpdateProfileSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input.',
          details: formatZodError(validationResult.error),
        },
        { status: 400 }
      );
    }

    const {
      firstName,
      lastName,
      headline,
      bio,
      avatarUrl, // Zod schema uses avatarUrl
      coverPhotoUrl, // Zod schema uses coverPhotoUrl
      location,
      phoneNumber, // Zod schema uses phoneNumber
      websiteUrl, // Zod schema uses websiteUrl
      linkedinUrl, // Zod schema uses linkedinUrl
      githubUrl // Zod schema uses githubUrl
    } = validationResult.data;


    // Start a transaction
    await pool.query('BEGIN');

    // --- Update users table (first_name, last_name) ---
    // Only update if at least one of these fields is provided in the validated data
    if (firstName !== undefined || lastName !== undefined) {
        const userUpdateFields = [];
        const userUpdateValues = [];
        let userParamCount = 1;

        if (firstName !== undefined) {
            userUpdateFields.push(`first_name = $${userParamCount++}`);
            userUpdateValues.push(firstName === '' ? null : firstName);
        }
        if (lastName !== undefined) {
            userUpdateFields.push(`last_name = $${userParamCount++}`);
            userUpdateValues.push(lastName === '' ? null : lastName);
        }

        if (userUpdateFields.length > 0) { // Only proceed if there's something to update
            userUpdateFields.push(`updated_at = CURRENT_TIMESTAMP`); // Always update timestamp
            userUpdateValues.push(userId);
            const updateUserQuery = `UPDATE users SET ${userUpdateFields.join(', ')} WHERE id = $${userParamCount}`;
            await pool.query(updateUserQuery, userUpdateValues);
        }
    }

    // --- Update or Insert into user_profiles table ---
    // Use UPSERT (INSERT ON CONFLICT UPDATE) for user_profiles
    const profileUpdateFields = [];
    const profileInsertFields = ['user_id'];
    const profileInsertValuesPlaceholders = ['$1'];
    const profileUpdateValues = [userId]; // For user_id
    let paramCount = 2; // Start from $2 since $1 is user_id

    const addField = (fieldNameDb: string, value: any | undefined) => {
        // Check if the value is explicitly provided in the validated data (even if it's null after Zod processing an empty string)
        if (value !== undefined) {
            profileInsertFields.push(fieldNameDb);
            profileInsertValuesPlaceholders.push(`$${paramCount}`);
            profileUpdateFields.push(`${fieldNameDb} = $${paramCount}`);
            profileUpdateValues.push(value === '' ? null : value);
            paramCount++;
        }
    };

    // Use validated data fields
    addField('headline', headline);
    addField('bio', bio);
    addField('avatar_url', avatarUrl);
    addField('cover_photo_url', coverPhotoUrl);
    addField('location', location);
    addField('phone_number', phoneNumber);
    addField('website_url', websiteUrl);
    addField('linkedin_url', linkedinUrl);
    addField('github_url', githubUrl);

    // Only run UPSERT if there are profile fields to update
    if (profileUpdateFields.length > 0) {
        const upsertProfileQuery = `
            INSERT INTO user_profiles (${profileInsertFields.join(', ')}, updated_at)
            VALUES (${profileInsertValuesPlaceholders.join(', ')}, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE
            SET ${profileUpdateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        await pool.query(upsertProfileQuery, profileUpdateValues);
    } else if (firstName === undefined && lastName === undefined) {
        // If no user fields and no profile fields were updated
        return NextResponse.json(
            { success: false, error: 'No update fields provided.' },
            { status: 400 }
        );
    }

    // Commit transaction
    await pool.query('COMMIT');

    return NextResponse.json({ success: true, message: 'Profile updated successfully.' }, { status: 200 });

  } catch (error) {
    await pool.query('ROLLBACK'); // Rollback transaction on error
    console.error('Update Profile API Error:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while updating the profile.' },
      { status: 500 }
    );
  }
}
