export async function prepareAvatar(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8_000_000)throw new Error('Escolha uma foto JPG, PNG ou WebP de até 8 MB.');
 const bitmap=await createImageBitmap(file);
 const side=Math.min(bitmap.width,bitmap.height);
 const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
 const context=canvas.getContext('2d');if(!context)throw new Error('Não foi possível preparar a foto.');
 context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,160,160);
 bitmap.close();
 const webp=canvas.toDataURL('image/webp',.82);
 const image=webp.startsWith('data:image/webp;')?webp:canvas.toDataURL('image/png');
 if(image.length>180000)throw new Error('Não foi possível reduzir a foto para o tamanho aceito.');
 return image;
}
