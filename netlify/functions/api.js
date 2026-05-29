const { createClient } = require('@supabase/supabase-js');

const ADMIN_USERNAME = 'wjx123';
const ADMIN_PASSWORD = 'wjx123';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data) {
  return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...data }) };
}

function fail(statusCode, message) {
  return { statusCode, headers, body: JSON.stringify({ success: false, error: message }) };
}

function checkAdmin(username, password) {
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return false;
  }
  return true;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables not configured');
  }
  return createClient(url, key);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      const action = params.get('action');

      if (action === 'list') {
        const supabase = getSupabase();
        const { data: photos, error } = await supabase
          .from('photos')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw new Error('数据库查询失败: ' + error.message);
        return ok({ photos });
      }

      return fail(400, 'Invalid action');
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return fail(400, 'Invalid JSON body');
      }

      const { action } = body;

      if (action === 'login') {
        if (checkAdmin(body.username, body.password)) {
          return ok({ message: '登录成功' });
        }
        return fail(401, '用户名或密码错误');
      }

      if (action === 'like') {
        if (!body.id) return fail(400, '缺少照片 ID');

        const supabase = getSupabase();
        const { data: photo, error } = await supabase
          .from('photos')
          .select('likes')
          .eq('id', body.id)
          .single();

        if (error) throw new Error('照片不存在');
        const newLikes = (photo.likes || 0) + 1;

        const { data: updated, error: updateErr } = await supabase
          .from('photos')
          .update({ likes: newLikes })
          .eq('id', body.id)
          .select()
          .single();

        if (updateErr) throw new Error('点赞失败: ' + updateErr.message);
        return ok({ photo: updated });
      }

      if (action === 'add') {
        if (!checkAdmin(body.username, body.password)) {
          return fail(401, '用户名或密码错误，请重新登录');
        }
        if (!body.dataUrl || !body.title) {
          return fail(400, '缺少图片数据或标题');
        }

        const supabase = getSupabase();
        const base64Data = body.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('photos')
          .upload(fileName, buffer, {
            contentType: 'image/jpeg',
            upsert: false,
          });

        if (uploadErr) throw new Error('图片上传失败: ' + uploadErr.message);

        const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;

        const { data: photo, error: insertErr } = await supabase
          .from('photos')
          .insert({ url: publicUrl, title: body.title })
          .select()
          .single();

        if (insertErr) throw new Error('数据库写入失败: ' + insertErr.message);
        return ok({ photo });
      }

      if (action === 'delete') {
        if (!checkAdmin(body.username, body.password)) {
          return fail(401, '用户名或密码错误，请重新登录');
        }
        if (!body.id) return fail(400, '缺少照片 ID');

        const supabase = getSupabase();
        const { data: photo, error: findErr } = await supabase
          .from('photos')
          .select('url')
          .eq('id', body.id)
          .single();

        if (findErr) throw new Error('照片不存在');

        const urlParts = photo.url.split('/photos/');
        if (urlParts.length === 2) {
          const filePath = urlParts[1];
          await supabase.storage.from('photos').remove([filePath]);
        }

        const { error: deleteErr } = await supabase
          .from('photos')
          .delete()
          .eq('id', body.id);

        if (deleteErr) throw new Error('删除失败: ' + deleteErr.message);
        return ok({ message: '删除成功' });
      }

      return fail(400, 'Invalid action: ' + action);
    }

    return fail(405, 'Method not allowed');
  } catch (err) {
    console.error('API Error:', err);
    return fail(500, err.message || '服务器内部错误');
  }
};
